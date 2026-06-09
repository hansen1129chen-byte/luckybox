# 工作规则
每次改完代码立即 git add . && git commit -m "描述改动" && git push
绝不直接改服务器文件，一切从本地发起

# 项目结构
- client/ 前端 Vue 3 源码（npm run dev / npm run build）
- server/ 后端 Express API（PORT=3003, DB=luckybox_db）
- dist/ 前端编译产物（不要手动改这里）

# 隔离
- 路由前缀: /lucky_box
- API: /lucky_box/api
- 数据库: luckybox_db (MySQL)
- 端口: 3003
