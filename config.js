/* ============================================================
   成员配置文件
   ============================================================
   你可以直接编辑此文件来管理小组成员。
   
   字段说明：
   - id: 唯一标识符（英文/数字，不要重复）
   - name: 显示名称（中文）
   - password: 登录密码（注意：客户端明文存储，仅用于轻度访问控制，不安全）
   - role: 'leader' | 'operator_bilibili' | 'operator_douyin' | 'operator_zhihu' | 'member'
           - leader: 组长（权重 3，对所有请求都享受高权重）
           - operator_*: 平台运营者（每个平台只能有1人，对涉及自己平台的请求享受权重 3）
           - member: 普通组员（权重 1）
   
   投票权重（在 app.js 中可调整）：
   - 内容作者本人：自动同意，权重 3
   - 组长：权重 3（对所有请求生效）
   - 涉及平台的运营者：权重 3（仅对涉及自己平台的步骤）
   - 其他人：权重 1
   ============================================================ */

const MEMBERS = [
    // ===== 1 名组长 =====
    { id: "leader01", name: "组长",   password: "Ua20220224",   role: "leader" },

    // ===== 3 名运营者 =====
    { id: "user01", name: "b站负责人", password: "Ua20220224", role: "operator_bilibili" },
    { id: "user02", name: "CSFS（抖音）", password: "Cc3310121029",   role: "operator_douyin" },
    { id: "user03", name: "CSFS（知乎）", password: "Cc3310121029",    role: "operator_zhihu" },

    // ===== 16 名普通组员 =====
    { id: "user04", name: "乐子", password: "Ua20220224", role: "member" },
    { id: "user05", name: "Big", password: "Ua20220224", role: "member" },
    { id: "user06", name: "近卫掷弹兵官", password: "Ua20220224", role: "member" },
    { id: "user07", name: "D.Kaufman", password: "Ua20220224", role: "member" },
    { id: "user08", name: "怠惰怠惰璃", password: "Ua20220224", role: "member" },
    { id: "user09", name: "俄国酷老头", password: "Ua20220224", role: "member" },
    { id: "user10", name: "hdg", password: "Ua20220224", role: "member" },
    { id: "user11", name: "火星人退散", password: "Ua20220224", role: "member" },
    { id: "user12", name: "浆果猫", password: "Ua20220224", role: "member" },
    { id: "user13", name: "冷亚尔的T-90M", password: "Ua20220224", role: "member" },
    { id: "user14", name: "路易斯小石", password: "Ua20220224", role: "member" },
    { id: "user15", name: "施富德", password: "Ua20220224", role: "member" },
    { id: "user16", name: "田园の灰狐", password: "Ua20220224", role: "member" },
    { id: "user17", name: "希腊大战游牧民族", password: "Ua20220224", role: "member" },
    { id: "user18", name: "语冰", password: "Ua20220224", role: "member" },
    { id: "user19", name: "101egale", password: "Ua20220224", role: "member" },
];

/* ============================================================
   投票通过的加权计算逻辑（可在 app.js 中查看完整实现）
   ============================================================
   - 作者本人对自己内容投票自动算同意（不可投反对）
   - 其他人是「反对票」机制：默认通过，除非反对加权分数过高
   - 投票匿名：只显示参与人数，不显示具体投票人
   - 投票截止：
       • 主发布步骤：提交后 1 小时
       • 同步到其他平台步骤：提交后 3 小时
   
   权重 (W)：
     • 作者本人：3（自动同意）
     • 组长：3（对所有步骤生效）
     • 涉及平台的运营者：3（仅对涉及自己平台的步骤生效）
     • 其他人：1
   
   计算：
     - 反对加权总分 R = Σ (反对者的权重)
     - 同意加权总分 A = Σ (同意者的权重) + W_作者(=3，因作者必同意)
     - 通过条件：R / (R + A) < 0.4   (即反对加权占比小于40%)
     - 但有硬性下限保护：若 R 的加权分 ≥ 6 也直接否决
       （例如：相关运营者 + 组长全部反对 = 3+3 = 6）
     - 已截止时按当前结果计算最终结论
   ============================================================ */
