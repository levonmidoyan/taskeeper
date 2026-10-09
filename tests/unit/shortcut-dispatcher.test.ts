// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDispatcher } from '@/lib/shortcuts/dispatcher';
import { activeScope } from '@/lib/shortcuts/guards';

let clock = 0;
const make = () => createDispatcher({ isMac: () => false, now: () => clock });

function press(d: ReturnType<typeof make>, key: string, init: KeyboardEventInit = {}, target: Element = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'target', { value: target });
  d.handle(e);
  return e;
}

afterEach(() => {
  document.body.innerHTML = '';
  clock = 0;
});

describe('activeScope', () => {
  const key = (target: Element = document.body) => {
    const e = new KeyboardEvent('keydown', { key: 'j' });
    Object.defineProperty(e, 'target', { value: target });
    return e;
  };

  it('is nav with nothing open', () => {
    expect(activeScope(key())).toBe('nav');
  });

  it('is detail with the task dialog or task page present', () => {
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"></div>';
    expect(activeScope(key())).toBe('detail');
  });

  it('is none while typing', () => {
    document.body.innerHTML = '<input id="i"><textarea id="t"></textarea><div id="c" contenteditable="true"></div>';
    for (const id of ['i', 't']) expect(activeScope(key(document.getElementById(id)!))).toBe('none');
    const editable = document.getElementById('c')!;
    // jsdom does not implement isContentEditable.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(activeScope(key(editable))).toBe('none');
  });

  it('is none when another overlay is open, even over the task dialog', () => {
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"></div><div role="listbox"></div>';
    expect(activeScope(key())).toBe('none');
    document.body.innerHTML = '<div role="menu"></div>';
    expect(activeScope(key())).toBe('none');
  });

  it('is none during a board keyboard drag', () => {
    document.body.innerHTML = '<button aria-roledescription="sortable" aria-pressed="true"></button>';
    expect(activeScope(key())).toBe('none');
  });
});

describe('dispatcher', () => {
  it('runs the bound handler in its scope and prevents default', () => {
    const d = make();
    const next = vi.fn();
    d.bind('nav.next', next);
    const e = press(d, 'j');
    expect(next).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it('matches every alternative key', () => {
    const d = make();
    const next = vi.fn();
    d.bind('nav.next', next);
    press(d, 'ArrowDown');
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips handlers outside the active scope', () => {
    const d = make();
    const navNext = vi.fn();
    const detailNext = vi.fn();
    d.bind('nav.next', navNext);
    d.bind('detail.next', detailNext);
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"></div>';
    press(d, 'j');
    expect(navNext).not.toHaveBeenCalled();
    expect(detailNext).toHaveBeenCalledOnce();
  });

  it('runs global shortcuts in both scopes', () => {
    const d = make();
    const help = vi.fn();
    d.bind('general.help', help);
    press(d, '?');
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"></div>';
    press(d, '?');
    expect(help).toHaveBeenCalledTimes(2);
  });

  it('leaves the event alone when the handler returns false', () => {
    const d = make();
    d.bind('nav.next', () => false);
    expect(press(d, 'ArrowDown').defaultPrevented).toBe(false);
  });

  it('ignores unbound shortcuts', () => {
    const d = make();
    expect(press(d, 'j').defaultPrevented).toBe(false);
  });

  it('lets the latest binding of an id win, and unbinding restores the previous', () => {
    const d = make();
    const first = vi.fn();
    const second = vi.fn();
    d.bind('nav.next', first);
    const unbind = d.bind('nav.next', second);
    press(d, 'j');
    expect(second).toHaveBeenCalledOnce();
    unbind();
    press(d, 'j');
    expect(first).toHaveBeenCalledOnce();
  });

  it('does nothing while typing or with a foreign overlay open', () => {
    const d = make();
    const next = vi.fn();
    d.bind('detail.next', next);
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"><input id="title"></div>';
    press(d, 'j', {}, document.getElementById('title')!);
    document.body.insertAdjacentHTML('beforeend', '<div role="listbox"></div>');
    press(d, 'j');
    expect(next).not.toHaveBeenCalled();
  });

  describe('chords', () => {
    it('completes g then b within the window', () => {
      const d = make();
      const board = vi.fn();
      const left = vi.fn();
      d.bind('goto.board', board);
      d.bind('nav.left', left);
      expect(press(d, 'g').defaultPrevented).toBe(true);
      clock = 900;
      press(d, 'b');
      expect(board).toHaveBeenCalledOnce();
    });

    it('swallows the second key so it never falls through to a single-key shortcut', () => {
      const d = make();
      const list = vi.fn();
      const right = vi.fn();
      d.bind('goto.list', list);
      d.bind('nav.right', right);
      press(d, 'g');
      press(d, 'l');
      expect(list).toHaveBeenCalledOnce();
      expect(right).not.toHaveBeenCalled();
    });

    it('expires after the window; the late key then acts on its own', () => {
      const d = make();
      const list = vi.fn();
      const right = vi.fn();
      d.bind('goto.list', list);
      d.bind('nav.right', right);
      press(d, 'g');
      clock = 1001;
      press(d, 'l');
      expect(list).not.toHaveBeenCalled();
      expect(right).toHaveBeenCalledOnce();
    });

    it('drops a pending chord when the second key is unbound', () => {
      const d = make();
      const board = vi.fn();
      d.bind('goto.board', board);
      press(d, 'g');
      press(d, 'z');
      press(d, 'b');
      expect(board).not.toHaveBeenCalled();
    });

    it('does not start a chord when no chord is bound', () => {
      const d = make();
      expect(press(d, 'g').defaultPrevented).toBe(false);
    });
  });
});
