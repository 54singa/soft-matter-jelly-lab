# Soft Matter · 果冻实验室

**简体中文** ｜ [English](README_EN.md)

一个可交互的 Three.js 软体果冻实验。果冻采用圆润的布丁造型：顶部较小且平缓，侧面带有轻微凹槽，底部宽大圆润。页面专注于材质、形变与手感实验，不包含视频或社交平台界面。

## 在线体验

**[点击体验果冻实验室](https://54singa.github.io/soft-matter-jelly-lab/)**

[![Soft Matter 果冻实验室](docs/soft-matter-jelly-lab.png)](https://54singa.github.io/soft-matter-jelly-lab/)

## 玩法

- 用鼠标或手指拖动果冻表面的任意位置。
- 松手后，果冻会根据弹性与惯性继续运动。
- 可以切换莓果、薄荷和蜂蜜三种颜色。
- 可以分别调节硬度与内部阻尼。
- 点击“重置”或按 `R` 键恢复果冻形状，当前材质参数会保留。
- 滑块支持方向键、`Home` 和 `End` 键操作。

## 本地运行

需要 Node.js 22.13 或更高版本。

```sh
npm install
npm run dev -- --port 4399
```

打开终端中显示的地址。生成静态生产版本：

```sh
npm run build
```

生成的网站位于 `dist/client/`，可以通过任意静态 HTTP 服务器运行。WebGPU 需要 localhost 或 HTTPS；不支持 WebGPU 时会自动回退到 WebGL2。

## 实现方式

`lib/soft-body.ts` 包含一个在 CPU 上运行的 XPBD 软体求解器：343 个粒子、1,296 个四面体体积约束，以及弹性边约束、重力、地面摩擦和速度阻尼。固定 120 Hz 的求解器通过插值驱动更细腻的平滑表面。射线检测的重心坐标会把精确抓取位置映射到模拟粒子，因此拖动会产生局部拉伸，而不是简单缩放整个模型。

`lib/jelly.ts` 包含 Three.js WebGPURenderer 场景。透光物理节点材质、双面表面、清漆、光线吸收、近似厚度场、折射环境光、动态法线与柔和接触阴影，共同形成湿润通透的视觉效果。场景优先使用 WebGPU，并提供 WebGL2 回退方案。

`app/page.tsx` 包含交互控制和经过功能检测的可选 WebMCP `configure_jelly` 工具。项目没有服务端数据存储，也不依赖外部运行时资源。

## 验证

项目已在浏览器中测试果冻正面、顶部和侧面的拖动交互，并验证 WebGPU 与 WebGL2 渲染。抓取时会产生局部形变，松手后运动会延续并逐渐衰减。颜色切换、键盘控制滑块、重置功能、材质软硬与阻尼边界也已检查。
