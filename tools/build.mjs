import {readFile, writeFile} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const model = (await read('src/model.js')).replaceAll('export ', '');
const controller = (await read('src/session-controller.js')).replace(/^import .*;\n/, '').replaceAll('export ', '');
const widget = (await read('src/widget.js')).replace(/^import .*;\n/, '').replaceAll('export ', '');
const css = await read('src/widget.css');
const bridge = `
const React = require('react');
exports.name = 'dsh-life-window';
exports.inject = ['slots', 'sessions', 'connection'];
exports.apply = function(ctx) {
  const life = createLifeWindow({css: ${JSON.stringify(css)}});
  const controller = createSessionController(ctx.sessions, ctx.connection.api, view => life.setSessionView(view));
  life.setController(controller);
  controller.refresh();
  function Bridge(props) {
    React.useEffect(() => () => controller.clearCurrent(props.sessionId), [props.sessionId]);
    React.useEffect(() => {controller.setCurrent(props.session);}, [props.session]);
    return null;
  }
  ctx.effect(() => ctx.slots.register({name:'conversation.input.left', id:'dsh-life-window', order:210}, Bridge));
  ctx.effect(() => () => controller.destroy());
  ctx.effect(() => () => life.destroy());
};`;
await writeFile(new URL('lib/client.js', root), `window.__ModuleLoader__.load({id:'dsh-life-window',factory:(require)=>{const module={exports:{}};const exports=module.exports;${model}\n${controller}\n${widget}\n${bridge}\nreturn module.exports;}});\n`);
console.log('已构建 DSH 客户端模块。');
