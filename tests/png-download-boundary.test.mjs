import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSyntheticPngDownload} from '../src/app/png-download.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YlxYy8AAAAASUVORK5CYII=';
const validName = 'virgostars-synthetic-natal-light.png';
const instrument = () => {
  const events = [];
  const anchor = {href:'', download:'', click:()=>events.push('click'), remove:()=>events.push('remove')};
  const port = {createAnchor:()=>{events.push('create');return anchor;}, appendAnchor:()=>events.push('append')};
  return {events,port,anchor};
};

test('valid synthetic target still creates, clicks and removes its anchor', () => {
  const h = instrument();
  requestSyntheticPngDownload(png, validName, h.port);
  assert.deepEqual(h.events, ['create','append','click','remove']);
  assert.equal(h.anchor.href, png);
  assert.equal(h.anchor.download, validName);
});

test('rejects remote, script, HTML and noncanonical PNG URL inputs before DOM access', () => {
  for (const url of [
    'https://example.invalid/chart.png', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
    'DATA:IMAGE/PNG;BASE64,'+png.split(',')[1], png+'\n', png+'#fragment',
    'data:image/png;base64,AAAA', '', null, {},
  ]) {
    const h = instrument();
    assert.throws(()=>requestSyntheticPngDownload(url,validName,h.port),/Invalid PNG download/);
    assert.deepEqual(h.events,[], 'invalid URLs must not create anchors');
  }
});

test('rejects arbitrary filenames, path traversal and trailing newline before DOM access', () => {
  for(const name of [
    '../secret.png', 'birth-chart.png', 'virgostars-synthetic-natal-light.png\n',
    'virgostars-synthetic-NATAL-light.png', 'virgostars-synthetic-natal-light.svg',
    'virgostars-synthetic-natal-light.png/../x', '', null, {},
  ]) {
    const h=instrument();
    assert.throws(()=>requestSyntheticPngDownload(png,name,h.port),/Invalid PNG download/);
    assert.deepEqual(h.events,[]);
  }
});

test('enforces a bounded, canonical base64 transport even with a safe filename', () => {
  for(const url of [
    'data:image/png;base64,' + 'A'.repeat(32 * 1024 * 1024 + 4),
    'data:image/png;base64,' + 'A'.repeat(66),
    'data:image/png;base64,' + 'A'.repeat(64) + '\u2028',
  ]) {
    const h=instrument();
    assert.throws(()=>requestSyntheticPngDownload(url,validName,h.port),/Invalid PNG download/);
    assert.deepEqual(h.events,[]);
  }
});

test('rejects noncanonical Base64 padding bits before touching the DOM', () => {
  const body = png.split(',')[1];
  assert.equal(body.endsWith('='), true);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const beforePadding = body.length - 2;
  const previous = alphabet.indexOf(body[beforePadding]);
  assert.equal(previous % 4, 0, 'fixture has canonical single-byte padding');
  const mutated = body.slice(0, beforePadding) + alphabet[previous + 1] + '=';
  assert.deepEqual(Buffer.from(body, 'base64'), Buffer.from(mutated, 'base64'),
    'a decoder sees the same bytes despite distinct input strings');
  const h = instrument();
  assert.throws(() => requestSyntheticPngDownload('data:image/png;base64,' + mutated, validName, h.port),
    /Invalid PNG download/);
  assert.deepEqual(h.events, []);
  for (const suffix of ['AB==', 'AAB=']) {
    const bad = 'data:image/png;base64,' + 'A'.repeat(60) + suffix;
    const mirror = instrument();
    assert.throws(() => requestSyntheticPngDownload(bad, validName, mirror.port), /Invalid PNG download/);
    assert.deepEqual(mirror.events, []);
  }
});
