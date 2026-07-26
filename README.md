# 宿舍床位管理系统前端

基于 Vue 3、Vite、Vue Router、Axios 和 Element Plus 的前端项目骨架。

## 当前阶段

- 统一身份登录入口
- 基于登录响应 `roleCode` 的访问控制模型
- 角色中台与业务模块入口
- 业务页面路由占位
- 403、404 状态页

登录页调用 `POST /api/auth/login`。成功后保存 token 与用户信息，并根据后端返回的
`roleCode` 生成对应的中台入口。

开发环境的接口根地址配置在 `.env.development`，当前为
`http://localhost:8080/api`。

## 开发环境

- Node.js 20+
- npm 10+

## 常用命令

```bash
npm install
npm run dev
```

## 目录结构

```text
src/
├── api/          # Axios 实例与接口模块
├── assets/       # 图片、字体等静态资源
├── components/   # 通用组件
├── config/       # 角色与模块权限配置
├── layouts/      # 系统通用布局
├── router/       # 路由与访问守卫
├── stores/       # 登录会话状态
├── styles/       # 全局样式
├── views/        # 业务页面
├── App.vue       # 根组件
└── main.js       # 应用入口
```
