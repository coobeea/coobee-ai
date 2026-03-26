import { describe, it, expect, beforeEach } from 'vitest';
import { TranscriptBuffer } from '../TranscriptBuffer';

describe('TranscriptBuffer', () => {
  let buffer: TranscriptBuffer;

  beforeEach(() => {
    buffer = new TranscriptBuffer();
  });

  it('starts empty', () => {
    expect(buffer.getFullText()).toBe('');
    expect(buffer.getNewText()).toBe('');
    expect(buffer.getNewCharCount()).toBe(0);
  });

  it('appends text', () => {
    buffer.append('hello ');
    buffer.append('world');
    expect(buffer.getFullText()).toBe('hello world');
    expect(buffer.getNewCharCount()).toBe(11);
  });

  it('tracks new text since last analysis', () => {
    buffer.append('first part. ');
    buffer.markAnalyzed();
    expect(buffer.getNewCharCount()).toBe(0);
    expect(buffer.getNewText()).toBe('');

    buffer.append('second part.');
    expect(buffer.getNewText()).toBe('second part.');
    expect(buffer.getNewCharCount()).toBe(12);
  });

  it('keeps full text after markAnalyzed', () => {
    buffer.append('aaa');
    buffer.markAnalyzed();
    buffer.append('bbb');
    expect(buffer.getFullText()).toBe('aaabbb');
  });

  it('resets to empty', () => {
    buffer.append('some text');
    buffer.reset();
    expect(buffer.getFullText()).toBe('');
    expect(buffer.getNewCharCount()).toBe(0);
    expect(buffer.getLastAnalyzedPos()).toBe(0);
  });
});
