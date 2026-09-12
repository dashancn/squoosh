# 智能抠图资源限制

普通编码文件最多 20 MiB。仅接受按真实签名且能在解码前可靠取得显示尺寸的 JPEG（含 EXIF orientation）、PNG/APNG、WebP 和 AVIF；未知、损坏或无法把 AVIF 主图关联到 `ispe` 尺寸的文件 fail-closed。预缩放解码最多 3000 万像素，文件头显示宽高均不超过 10000 像素；超过 800 万像素的普通图片会自动缩小到不超过 800 万像素。优化后的编码文件最多 8 MiB。编辑器按 256 MiB 内存预算设计。

预处理阶段同样按 256 MiB fail-closed：最坏情况下同时计入 3000 万像素 source bitmap、实际 800 万像素以内的 resize canvas backing、processed bitmap、20 MiB 原始编码文件、8 MiB 优化后编码 Blob，以及 32 MiB 浏览器运行时余量。按 7500 × 4000 输入和实际缩放结果 3872 × 2065 计算，峰值为 246,880,000 bytes（235.44 MiB），距硬预算 21,555,456 bytes（20.56 MiB）。任何尺寸、文件大小或分配合计无法安全证明，或优化后 Blob 超过 8 MiB，都会在再次解码前拒绝。

HEIC/HEIF 使用不同且更严格的策略：原文件最多 8 MiB；worker 先用 libheif 打开容器取得主图尺寸，不创建 `ImageData` 或画布，确认边长不超过 10000 且源图不超过独立的 3000 万像素瞬时上限后才转换。当前 libheif 接口不提供缩放解码，因此 worker 必须短暂持有完整源图 RGBA；随后立即在 worker 内缩小到不超过 800 万像素。支持 `OffscreenCanvas` 时直接在 worker 编码 PNG；不支持时仅把已缩小的 RGBA 转交主线程画布编码，不传输完整源图像素。转换 PNG 不得超过 8 MiB。显式清单包括原 HEIC File、worker `arrayBuffer()` 副本、完整源图解码 RGBA、最多 8 MP 的缩放 RGBA、转换画布 backing 和 PNG 输出。libheif/libde265 的 WASM heap、内部解码表面以及浏览器实现中的额外复制无法由应用代码可靠计量，所以**不宣称 HEIC 预处理具备完整 256 MiB 峰值证明**；30 MP 只用于覆盖常见手机源图，编辑、转换输出与主线程 fallback 始终限制在 8 MP。

800 万像素是编辑阶段 256 MiB 移动端标签页预算下通过保守分配清单的最高整百万像素上限。清单按最坏的未裁剪导出计算，并同时保留：原图 RGBA、可编辑蒙版、原始 alpha、蒙版历史初始快照、选择预览画布、结果预览 ImageData、导出输出、导出画布 backing、输入与前景 Blob、历史与正在绘制的笔画预算，以及 32 MiB 浏览器/模型运行时余量。笔画的 8 MiB 清单明确覆盖录制（位图去重、索引、before）、完成（再加入 after）和直接转交历史后三个阶段的峰值；达到上限后停止应用新的蒙版像素并提示松开后继续，不会产生无法撤销的越界修改。

`editMask`、`maskHistory` 的 current live view 和 `currentView()` 通过 `adoptCurrent` 共享同一个实时蒙版分配；历史 initial 仍单独计入。undo、redo 和 reset 都原地修改这块实时蒙版（reset 使用 `current.set(initial)`），返回实时 view，不产生防御性全尺寸蒙版快照；只有显式调用 `current()` 才创建快照。800 万像素各导航阶段的实时蒙版为 8,000,000 bytes，返回快照为 0 bytes。完整最坏阶段估算仍为 251,600,384 bytes（239.94 MiB），其中已包含 32 MiB 浏览器/模型运行时余量，并且距 268,435,456 bytes 硬预算另有 16,835,072 bytes（16.06 MiB）余量；下一个整百万像素档 900 万估算为 270,600,384 bytes（258.06 MiB），超过预算。
