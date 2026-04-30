/* ============================================================
   成员配置文件
   ============================================================
   你可以直接编辑此文件来管理小组成员。
   
   字段说明：
   - id: 唯一标识符（英文/数字，不要重复）
   - name: 显示名称（中文）
   - password: 登录密码（注意：客户端明文存储，仅用于轻度访问控制，不安全）
   - role: 'operator_bilibili' | 'operator_douyin' | 'operator_zhihu' | 'member'
           前三种是平台运营者（每个平台只能有1人），最后一种是普通组员
   
   投票权重（在 app.js 中可调整）：
   - 内容作者本人：自动同意，无需投票
   - 涉及平台的运营者：权重 3
   - 普通组员：权重 1
   ============================================================ */

const MEMBERS = [
    // ===== 3 名运营者 =====
    { id: "user01", name: "张三", password: "b站负责人", role: "operator_bilibili" },
    { id: "user02", name: "李四", password: "CSFS（抖音）",   role: "Cc310121029" },
    { id: "user03", name: "王五", password: "CSFS（知乎）",    role: "Cc3310121029" },

    // ===== 17 名普通组员 =====
    { id: "user04", name: "成员A", password: "pass04", role: "member" },
    { id: "user05", name: "成员B", password: "pass05", role: "member" },
    { id: "user06", name: "成员C", password: "pass06", role: "member" },
    { id: "user07", name: "成员D", password: "pass07", role: "member" },
    { id: "user08", name: "成员E", password: "pass08", role: "member" },
    { id: "user09", name: "成员F", password: "pass09", role: "member" },
    { id: "user10", name: "成员G", password: "pass10", role: "member" },
    { id: "user11", name: "成员H", password: "pass11", role: "member" },
    { id: "user12", name: "成员I", password: "pass12", role: "member" },
    { id: "user13", name: "成员J", password: "pass13", role: "member" },
    { id: "user14", name: "成员K", password: "pass14", role: "member" },
    { id: "user15", name: "成员L", password: "pass15", role: "member" },
    { id: "user16", name: "成员M", password: "pass16", role: "member" },
    { id: "user17", name: "成员N", password: "pass17", role: "member" },
    { id: "user18", name: "成员O", password: "pass18", role: "member" },
    { id: "user19", name: "成员P", password: "pass19", role: "member" },
    { id: "user20", name: "成员Q", password: "pass20", role: "member" },
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
     • 涉及平台的运营者：3
     • 其他运营者 / 普通组员：1
   
   计算：
     - 反对加权总分 R = Σ (反对者的权重)
     - 同意加权总分 A = Σ (同意者的权重) + W_作者(=3，因作者必同意)
     - 通过条件：R / (R + A) < 0.4   (即反对加权占比小于40%)
     - 但有硬性下限保护：若 R 的加权分 ≥ 6 也直接否决
       （例如：2名相关运营者反对 = 6，或1名相关运营者+3名普通成员反对）
     - 已截止时按当前结果计算最终结论
   ============================================================ */
