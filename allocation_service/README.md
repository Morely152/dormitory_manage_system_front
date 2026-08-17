# 排寝 MCMF 服务

服务为 `/accommodation/bed-allocation-new` 提供唯一的 Flask 排寝引擎：最小费用最大流（MCMF）先生成全员可行解，再可选地执行 Repair、LNS 和模拟退火；不调用前端贪心或 worker。

## 启动

在项目根目录执行：

    npm run dev:allocation

该命令启动独立的 Flask 算法服务：`http://127.0.0.1:5001`。另开终端运行 `npm run dev` 启动 Vue 前端；排寝页面通过专用 Axios 客户端直接请求该端口。

修改 `vite.config.js`、`.env` 或算法服务地址后，必须停止并重新启动 `npm run dev`，代理配置不会热更新。

专用客户端 `src/api/allocation/http.js` 默认请求 `http://127.0.0.1:5001/api/allocation`。如需更换算法服务地址，设置 `VITE_ALLOCATION_API_BASE_URL` 为包含 `/api/allocation` 的完整地址。Flask 已允许本机 `http://localhost:5173` 和 `http://127.0.0.1:5173` 跨域访问。

## 当前接口

- GET /api/allocation/v1/health
- POST /api/allocation/v1/solve
- POST /api/allocation/v1/improve

`solve` 接收原始 beds、studentRows、兼容关系、临时楼栋性别、预留、研究生锁定或研究生楼栋路径，返回兼容现有热力图和预览的 MCMF 初始快照。`improve` 使用相同请求重新生成初始解，然后执行房间纯度 Repair、LNS 重建和模拟退火，只返回不差于初始解的历史最优快照。

临时楼栋性别为 `unknown` 时，该楼栋所有可用床位都被排除，并在 `diagnostics.feasibilityCertificate` 中说明被排除的容量。北苑同学院男女互斥只检查本次计划和锁定研究生方案；已入住老生只用于判断部分入住寝室的性别。

## 验证

    python -m unittest allocation_service.tests.test_planner -v
