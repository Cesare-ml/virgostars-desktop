import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesktopShortcut } from '../src/app/desktop-shortcuts.ts';

const key = (code, extra = {}) => ({
  code, altKey: true, shiftKey: true, ctrlKey: false, metaKey: false,
  repeat: false, target: null, ...extra
});

test('maps only the four explicitly available synthetic chart modes', () => {
  for (const [digit, mode] of [['1','natal'],['2','transits'],['3','synastry'],['4','latitude']]) {
    assert.deepEqual(parseDesktopShortcut(key('Digit'+digit)), {kind:'mode',mode});
  }
});
test('dedicated fit action does not start a calculation or export', () => {
  assert.deepEqual(parseDesktopShortcut(key('Digit0')), {kind:'fit'});
});
test('all unrelated keys and alternate digit input are ignored', () => {
  for (const code of ['Digit5','Numpad1','KeyF','KeyA','','F5']) {
    assert.equal(parseDesktopShortcut(key(code)), null);
  }
});
test('requires both modifiers, without Ctrl or Meta', () => {
  const options = [
    {altKey:false},{shiftKey:false},{ctrlKey:true},{metaKey:true},
    {altKey:false,shiftKey:false},{altKey:true,shiftKey:true,ctrlKey:true}
  ];
  for (const flags of options) assert.equal(parseDesktopShortcut(key('Digit1',flags)), null);
});
test('repeat events cannot flood renderer requests', () => {
  assert.equal(parseDesktopShortcut(key('Digit1',{repeat:true})), null);
});
test('native input, textarea and select elements keep their keyboard input', () => {
  for (const tagName of ['INPUT','input','TEXTAREA','SELECT']) {
    assert.equal(parseDesktopShortcut(key('Digit2',{target:{tagName}})), null);
  }
});
test('contenteditable regions block shortcuts', () => {
  assert.equal(parseDesktopShortcut(key('Digit3',{target:{tagName:'DIV',isContentEditable:true}})), null);
  assert.equal(parseDesktopShortcut(key('Digit3',{target:{tagName:'SPAN',closest:()=>({})}})), null);
});
test('a non-editable button is safe for navigation', () => {
  assert.deepEqual(parseDesktopShortcut(key('Digit4',{target:{tagName:'BUTTON',closest:()=>null}})),{kind:'mode',mode:'latitude'});
});
test('shadow-dom event path preserves text input safety', () => {
  assert.equal(parseDesktopShortcut(key('Digit2',{
    target:{tagName:'CUSTOM-SEARCH'},composedPath:()=>[{tagName:'INPUT'}, {tagName:'CUSTOM-SEARCH'}]
  })), null);
});
test('malformed composedPath fails closed', () => {
  assert.equal(parseDesktopShortcut(key('Digit2',{composedPath:()=>null})),null);
  assert.equal(parseDesktopShortcut(key('Digit2',{composedPath:()=>{throw new Error('mock')}})),null);
});
test('malformed closest checks fail closed', () => {
  assert.equal(parseDesktopShortcut(key('Digit1',{target:{tagName:'DIV',closest:()=>{throw new Error('mock')}}})),null);
});
test('plain shortcuts never claim unsupported chart calculations', () => {
  const intents = ['Digit0','Digit1','Digit2','Digit3','Digit4'].map(code=>parseDesktopShortcut(key(code)));
  assert.ok(intents.every(intent=>intent && ['mode','fit'].includes(intent.kind)));
});

test('IME composition does not trigger chart mode changes', () => {
  assert.equal(parseDesktopShortcut(key('Digit2',{isComposing:true})), null);
});
test('already-handled shortcut events remain untouched', () => {
  assert.equal(parseDesktopShortcut(key('Digit1',{defaultPrevented:true})), null);
});

test('ARIA composite editors keep their hotkeys, even when built from divs', () => {
  for (const role of ['textbox','searchbox','combobox','spinbutton','slider','listbox','grid','gridcell','menu','menuitem']) {
    const target = {tagName:'DIV',getAttribute:name => name === 'role' ? role : null,closest:()=>null};
    assert.equal(parseDesktopShortcut(key('Digit1',{target})),null,role);
  }
});
test('ARIA dialog and native dialog block chart changes from their buttons', () => {
  for (const role of ['dialog','alertdialog']) {
    const target = {tagName:'BUTTON',closest:selector => selector.includes(`[role="${role}"]`) ? {} : null};
    assert.equal(parseDesktopShortcut(key('Digit2',{target})),null,role);
  }
  assert.equal(parseDesktopShortcut(key('Digit2',{target:{tagName:'DIALOG'}})),null);
  assert.equal(parseDesktopShortcut(key('Digit2',{target:{tagName:'BUTTON',closest:selector=>selector.includes('dialog') ? {} : null}})),null);
});
test('aria-modal dialog container blocks shortcuts', () => {
  const target = {tagName:'DIV',getAttribute:name=>name==='aria-modal' ? 'true' : null,closest:()=>null};
  assert.equal(parseDesktopShortcut(key('Digit3',{target})),null);
});
test('role fallbacks and mixed-case roles remain protected', () => {
  const target = {tagName:'DIV',getAttribute:name=>name==='role' ? 'custom TeXtBoX' : null,closest:()=>null};
  assert.equal(parseDesktopShortcut(key('Digit4',{target})),null);
});
test('role=toolbar does not hide shortcuts from normal workspace controls', () => {
  const target = {tagName:'BUTTON',getAttribute:name=>name==='role' ? 'toolbar' : null,closest:()=>null};
  assert.deepEqual(parseDesktopShortcut(key('Digit4',{target})),{kind:'mode',mode:'latitude'});
});
test('an ARIA editor inside the composed path cannot trigger a shortcut', () => {
  const target={tagName:'CUSTOM-DATE'};
  const inner={tagName:'DIV',getAttribute:name=>name==='role' ? 'spinbutton' : null,closest:()=>null};
  assert.equal(parseDesktopShortcut(key('Digit0',{target,composedPath:()=>[inner,target]})),null);
});
test('untrusted role getter errors fail closed', () => {
  const target={tagName:'DIV',getAttribute:()=>{throw new Error('untrusted node')}};
  assert.equal(parseDesktopShortcut(key('Digit1',{target})),null);
});
test('native select option is considered an editable target', () => {
  assert.equal(parseDesktopShortcut(key('Digit1',{target:{tagName:'OPTION'}})),null);
});
