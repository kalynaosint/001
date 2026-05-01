/* ============================================================
   核心逻辑
   ============================================================ */

// ============= Firebase 配置 =============
const firebaseConfig = {
    apiKey: "AIzaSyAjukPjldgy9utSn-qLzbQgawx1Mzh4vDs",
    authDomain: "voting-site-63369.firebaseapp.com",
    databaseURL: "https://voting-site-63369-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "voting-site-63369",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const requestsRef = db.ref("requests");

// 内存缓存 + 实时订阅
let _cachedRequests = [];
let _onUpdate = null;

requestsRef.on("value", snapshot => {
    const val = snapshot.val() || {};
    _cachedRequests = Object.values(val).map(r => {
        // 还原 syncToPlatforms 为数组
        if (r.syncToPlatforms && !Array.isArray(r.syncToPlatforms)) {
            r.syncToPlatforms = Object.values(r.syncToPlatforms);
        }
        // 还原每个 step 的 votes 为数组
        if (r.steps) {
            Object.keys(r.steps).forEach(k => {
                const v = r.steps[k].votes;
                if (!v) {
                    r.steps[k].votes = [];
                } else if (Array.isArray(v)) {
                    r.steps[k].votes = v;
                } else {
                    // 对象形式：取 values，过滤掉 __keep 占位
                    r.steps[k].votes = Object.values(v).filter(x => x && typeof x === "object" && x.userId);
                }
            });
        }
        return r;
    });
    if (_onUpdate) _onUpdate();
});

// ---- 平台映射 ----
const PLATFORMS = {
    bilibili: { name: "Bilibili", className: "platform-bilibili", operatorRole: "operator_bilibili" },
    douyin:   { name: "抖音",     className: "platform-douyin",   operatorRole: "operator_douyin" },
    zhihu:    { name: "知乎",     className: "platform-zhihu",    operatorRole: "operator_zhihu" },
};

// ---- 投票截止时间（毫秒） ----
const VOTE_DURATION_OWN_MS = 1 * 60 * 60 * 1000;   // 主发布：1 小时
const VOTE_DURATION_SYNC_MS = 3 * 60 * 60 * 1000;  // 同步到其他平台：3 小时

function getStepDuration(stepKey) {
    return stepKey === "ownPost" ? VOTE_DURATION_OWN_MS : VOTE_DURATION_SYNC_MS;
}

// ---- 加权权重 ----
const WEIGHT_OPERATOR_INVOLVED = 3; // 涉及平台的运营者
const WEIGHT_LEADER = 3;             // 组长（对所有步骤生效）
const WEIGHT_DEFAULT = 1;            // 其他人
const WEIGHT_AUTHOR = 3;             // 作者权重（作者自动同意）

// 反对占比阈值：超过则否决
const REJECT_RATIO_THRESHOLD = 0.4;
// 反对硬性下限：反对加权分超过此值直接否决
const REJECT_HARD_THRESHOLD = 6;

// ============================================================
// localStorage 数据层（封装方便日后切换为云端存储）
// ============================================================
const STORAGE_KEY_REQUESTS = "voting_site_requests_v1";
const STORAGE_KEY_SESSION = "voting_site_session_v1";

function loadRequests() {
    return _cachedRequests;
}

function saveRequests(requests) {
    const obj = {};
    requests.forEach(r => {
        const copy = JSON.parse(JSON.stringify(r));
        if (copy.steps) {
            Object.keys(copy.steps).forEach(k => {
                // 把 votes 数组转为对象（用 userId 做 key），避免空数组被吞 + 数组被转成对象的混乱
                const votesArr = copy.steps[k].votes || [];
                const votesObj = {};
                votesArr.forEach(v => { votesObj[v.userId] = v; });
                // 即使是空对象，也加一个占位字段保证节点存在
                votesObj.__keep = true;
                copy.steps[k].votes = votesObj;
            });
        }
        obj[r.id] = copy;
    });
    requestsRef.set(obj);
}

function loadSession() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY_SESSION);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function saveSession(user) {
    sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(user));
}

function clearSession() {
    sessionStorage.removeItem(STORAGE_KEY_SESSION);
}

// ============================================================
// 用户/成员相关
// ============================================================
function getMemberById(id) {
    return MEMBERS.find(m => m.id === id);
}

function isOperator(user) {
    return user && user.role && user.role.startsWith("operator_");
}

function isLeader(user) {
    return user && user.role === "leader";
}

function getOperatorPlatform(user) {
    if (!user) return null;
    if (user.role === "operator_bilibili") return "bilibili";
    if (user.role === "operator_douyin") return "douyin";
    if (user.role === "operator_zhihu") return "zhihu";
    return null;
}

function getRoleLabel(user) {
    if (!user) return "";
    if (isLeader(user)) return "组长";
    const p = getOperatorPlatform(user);
    if (p) return PLATFORMS[p].name + " 运营者";
    return "组员";
}

function getRoleClassName(user) {
    if (!user) return "role-member";
    if (isLeader(user)) return "role-leader";
    if (isOperator(user)) return "role-operator";
    return "role-member";
}

// ============================================================
// 投票核心：判断状态 / 计算结果
// ============================================================

/**
 * 计算针对某个 step（own 或 sync）当前的投票汇总
 * @returns {object} { approveScore, rejectScore, totalVoters, ratio, status, voters }
 *   status: 'pending' | 'approved' | 'rejected' | 'pending-deadline-passed'
 */
function computeVoteResult(request, stepKey) {
    const step = request.steps[stepKey];
    if (!step) return null;

    // 仅"对应平台的运营者"获得加权 3
    const platform = stepKey === "ownPost" ? request.authorPlatform : step.targetPlatform;
    const involvedOperatorRole = platform ? PLATFORMS[platform].operatorRole : null;

    let approveScore = 0;
    let rejectScore = 0;
    const voters = step.votes || [];

    voters.forEach(v => {
        const member = getMemberById(v.userId);
        if (!member) return;
        let weight = WEIGHT_DEFAULT;
        if (member.role === "leader") {
            weight = WEIGHT_LEADER;
        } else if (involvedOperatorRole && member.role === involvedOperatorRole) {
            weight = WEIGHT_OPERATOR_INVOLVED;
        }
        if (v.choice === "approve") approveScore += weight;
        else if (v.choice === "reject") rejectScore += weight;
    });

    // 作者自动同意，加上作者权重（如果作者本人不在已投者列表里）
    const authorAlreadyVoted = voters.some(v => v.userId === request.authorId);
    if (!authorAlreadyVoted) {
        approveScore += WEIGHT_AUTHOR;
    }

    const totalScore = approveScore + rejectScore;
    const rejectRatio = totalScore > 0 ? rejectScore / totalScore : 0;

    // 判断时间是否过截止（按步骤类型不同）
    const deadline = request.submittedAt + getStepDuration(stepKey);
    const now = Date.now();
    const expired = now >= deadline;

    // 决议规则：
    //   1) 反对加权达到硬性下限 → 立即否决
    //   2) 截止时按反对占比判定
    //   3) 未截止时若反对占比已超阈值，记为"暂时倾向否决"，仍允许翻盘
    let status = "pending";
    if (rejectScore >= REJECT_HARD_THRESHOLD) {
        status = "rejected";
    } else if (expired) {
        status = (rejectRatio >= REJECT_RATIO_THRESHOLD) ? "rejected" : "approved";
    } else {
        // 截止前不下最终结论，仅显示进行中
        status = "pending";
    }

    return {
        approveScore,
        rejectScore,
        rejectRatio,
        totalVoters: voters.length,
        status,
        voters,
        expired,
        deadline,
        now,
    };
}

/**
 * 综合判断整个 request 的状态：
 *   - 如果 ownPost 被否决 → 整个 request 状态：rejected
 *   - 如果存在 syncRequests 且全部 approved，且 ownPost 也 approved → approved
 *   - 否则按各 step 综合显示 in-progress / approved / rejected
 */
function computeRequestStatus(request) {
    const ownResult = computeVoteResult(request, "ownPost");
    if (!ownResult) return "in-progress";

    const syncSteps = Object.keys(request.steps).filter(k => k.startsWith("sync_"));
    const syncResults = syncSteps.map(k => computeVoteResult(request, k));

    // 任一被否决 → 整体显示 in-progress（仍可继续讨论），但会把对应步骤标红
    // 全部 approved → approved
    const allApproved =
        ownResult.status === "approved" &&
        syncResults.every(r => r.status === "approved");

    if (allApproved) return "approved";

    const allDecided =
        ownResult.status !== "pending" &&
        syncResults.every(r => r.status !== "pending");

    if (allDecided) {
        // 至少有一个被 reject
        const anyApproved = ownResult.status === "approved" ||
            syncResults.some(r => r.status === "approved");
        return anyApproved ? "partial" : "rejected";
    }

    return "in-progress";
}

// ============================================================
// 投票操作
// ============================================================
function castVote(requestId, stepKey, userId, choice) {
    const requests = loadRequests();
    const req = requests.find(r => r.id === requestId);
    if (!req) return { ok: false, msg: "请求不存在" };

    const step = req.steps[stepKey];
    if (!step) return { ok: false, msg: "步骤不存在" };

    // 作者不能对自己的内容投反对
    if (userId === req.authorId && choice === "reject") {
        return { ok: false, msg: "你是作者，无法对自己的内容投反对票（默认同意）" };
    }

    // 检查是否过截止
    const now = Date.now();
    if (now >= req.submittedAt + getStepDuration(stepKey)) {
        return { ok: false, msg: "投票已截止" };
    }

    if (!step.votes) step.votes = [];
    // 一人一票，可改票
    const existing = step.votes.find(v => v.userId === userId);
    if (existing) {
        existing.choice = choice;
        existing.timestamp = now;
    } else {
        step.votes.push({ userId, choice, timestamp: now });
    }

    saveRequests(requests);
    return { ok: true };
}

// ============================================================
// 创建新请求
// ============================================================
function createRequest({ authorId, title, content, authorPlatform, syncToPlatforms }) {
    const requests = loadRequests();
    const req = {
        id: "req_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
        authorId,
        title,
        content,
        authorPlatform,        // 作者负责的平台
        syncToPlatforms,       // 数组，希望同步到的其他平台
        submittedAt: Date.now(),
        steps: {
            ownPost: { votes: [] },  // 是否适合发到作者负责的平台
        },
    };
    syncToPlatforms.forEach(p => {
        req.steps["sync_" + p] = { targetPlatform: p, votes: [] };
    });
    requests.push(req);
    saveRequests(requests);
    return req;
}

function deleteRequest(requestId, userId) {
    const requests = loadRequests();
    const idx = requests.findIndex(r => r.id === requestId);
    if (idx < 0) return false;
    if (requests[idx].authorId !== userId) return false;
    requests.splice(idx, 1);
    saveRequests(requests);
    return true;
}

// ============================================================
// 工具
// ============================================================
function formatDate(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRemaining(ts) {
    const remaining = ts - Date.now();
    if (remaining <= 0) return "已截止";
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    if (hours > 0) return `剩余 ${hours} 小时 ${minutes} 分`;
    return `剩余 ${minutes} 分`;
}

function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
