import {createLifeWindow} from '/dsh-life/src/widget.js';
const response = await fetch('/dsh-life/src/widget.css');
if (!response.ok) throw new Error('生活窗样式加载失败');
createLifeWindow({css: await response.text(), container: document.querySelector('.holder'), embedded: true});
