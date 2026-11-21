import { describe, expect, it } from 'vitest';
import { WindowStack } from '../src/window-stack.js';

const make = (stack: WindowStack, id: string, exclusive = false) => {
  const state = { open: false, closes: 0 };
  stack.watch(id, () => state.open, () => { state.closes++; state.open = false; }, exclusive);
  return state;
};

describe('window stack: Escape closes the top-most window', () => {
  it('closes windows newest first, one per Escape, and reports an empty stack', () => {
    const stack = new WindowStack();
    const quests = make(stack, 'quests'), bank = make(stack, 'bank');
    quests.open = true; stack.refresh();
    bank.open = true; stack.refresh();
    expect(stack.open).toEqual(['quests', 'bank']);
    expect(stack.closeTop()).toBe(true);
    expect(bank.open).toBe(false); expect(quests.open).toBe(true); expect(quests.closes).toBe(0);
    expect(stack.closeTop()).toBe(true);
    expect(quests.open).toBe(false);
    expect(stack.closeTop()).toBe(false);
  });
  it('a window closed by its own button leaves the stack, and reopening puts it on top', () => {
    const stack = new WindowStack();
    const a = make(stack, 'a'), b = make(stack, 'b');
    a.open = true; stack.refresh(); b.open = true; stack.refresh();
    a.open = false; stack.refresh(); a.open = true; stack.refresh();
    expect(stack.open).toEqual(['b', 'a']);
    stack.closeTop(); expect(a.open).toBe(false); expect(b.open).toBe(true);
  });
  it('exclusive panels replace each other (guild opened over party closes the party window)', () => {
    const stack = new WindowStack();
    const party = make(stack, 'party', true), guild = make(stack, 'guild', true), bank = make(stack, 'bank');
    party.open = true; stack.refresh();
    bank.open = true; stack.refresh();
    guild.open = true; stack.refresh();
    expect(party.open).toBe(false); expect(party.closes).toBe(1);
    expect(guild.open).toBe(true); expect(bank.open).toBe(true);   // a server dialog is not a panel
    expect(stack.open).toEqual(['bank', 'guild']);
  });
  it('unwatch forgets a window', () => {
    const stack = new WindowStack(); const a = make(stack, 'a'); a.open = true; stack.refresh();
    stack.unwatch('a'); expect(stack.closeTop()).toBe(false); expect(a.closes).toBe(0);
  });
});
