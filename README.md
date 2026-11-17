# Behemiron Jolt Physics

BlockBench 插件，让模型全量支持 Jolt Physics：刚体、12 类约束、车辆、角色、软体、毛发与蒙皮。物理数据随 `.bbmodel` 保存，引擎（jolt-jni）直接读取。

## 安装

把 `dist/behemiron_jolt.js` 拖进 BlockBench 窗口，或 Plugins 菜单 → Load from file。离线可用，物理引擎已打包进单文件产物。

## 使用手册

**建模师从这开始：[`docs/MANUAL.md`](docs/MANUAL.md)** 。

## 开发

```bash
npm install
npm test          # node:test 纯逻辑（72 个）
npm run test:bb   # Blockbench 集成冒烟（CDP 直驱真实 BB，14 项；需 vendor/blockbench 软链或 BB_EXE）
npm run typecheck # tsc --noEmit（strict）
npm run lint      # eslint --max-warnings=0
npm run format    # prettier
npm run build     # 产物 dist/behemiron_jolt.js
```
