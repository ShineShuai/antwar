#!/usr/bin/env python3
"""Second implementation, written from the reference text only (World, Ant, Combat, Semantics and RNG tabs).

Classic rules, official .ant programs, toroidal worlds. Prints the canonical state hash every K rounds:
    python3 oracle/ref.py --map M --ant A [--ant B] --rounds N [--seed S] [--every K] [--no-wrap]
"""
import argparse
import json
import re
import struct

MOD30 = 1 << 30

# Rulesets mirror src/core/rules.ts. A flag this oracle does not implement is rejected, never ignored.
RULESETS = {'classic': dict(cap=1, ext=False, scare=0, dropfail=False, maxcol=2, altorder=False)}
IMPLEMENTED = {'cap': 1, 'ext': False, 'scare': 0, 'dropfail': False, 'maxcol': 2, 'altorder': False}  # extend with the ruleset


class Rng:
    """s' = (s * 22695477 + 1) mod 2^30; x_i = floor(s_(i+4) / 2^16) mod 2^14; randomint(n) = x_i mod n."""

    def __init__(self, seed):
        self.s = seed % MOD30
        self.draws = 0
        for _ in range(4):
            self.s = (self.s * 22695477 + 1) % MOD30

    def randomint(self, n):
        x = (self.s // 65536) % 16384
        self.s = (self.s * 22695477 + 1) % MOD30
        self.draws += 1
        return x % n


def parse_map(text):
    rows = [ln for ln in text.splitlines() if ln.strip()]
    w, h = int(rows[0]), int(rows[1])
    assert 3 <= w <= 200 and 3 <= h <= 200 and h % 2 == 0, 'world size: 3..200 per side, height even'
    assert len(rows) - 2 == h, 'row count'
    rock, food, base = set(), {}, {}
    for y, row in enumerate(rows[2:]):
        cells = re.sub(r'\s+', '', row)
        assert len(cells) == w, 'row width'
        for x, c in enumerate(cells):
            p = y * w + x
            if c == '#':
                rock.add(p)
            elif c == '+':
                base[p] = 0
            elif c == '-':
                base[p] = 1
            elif 'a' <= c <= 'z':
                base[p] = ord(c) - 97
            elif '1' <= c <= '9':
                food[p] = int(c)
            elif c != '.':
                raise ValueError('bad cell %r' % c)
    return w, h, rock, food, base


COND = ['friend', 'foe', 'friendwithfood', 'foewithfood', 'food', 'rock', 'marker', 'foemarker', 'home', 'foehome']


def parse_ant(text):
    prog = []
    lines = text.splitlines()
    while lines and not lines[-1].strip():  # trailing blank lines are ignored, like src/core/asm.ts
        lines.pop()
    for line in lines:
        t = line.split(';')[0].split()
        if not t:
            raise ValueError('empty state')
        op = t[0].lower()
        if op == 'sense':
            cond = t[4].lower()
            prog.append(('sense', t[1].lower(), int(t[2]), int(t[3]), cond, int(t[5]) if cond == 'marker' else 0))
        elif op in ('mark', 'unmark'):
            prog.append((op, int(t[1]), int(t[2])))
        elif op in ('pickup', 'move'):
            prog.append((op, int(t[1]), int(t[2])))
        elif op == 'drop':
            prog.append((op, int(t[1])))
        elif op == 'turn':
            prog.append((op, t[1].lower(), int(t[2])))
        elif op == 'flip':
            prog.append((op, int(t[1]), int(t[2]), int(t[3])))
        else:
            raise ValueError('unknown instruction %r' % op)
    return prog


class Ant:
    __slots__ = ('id', 'colony', 'pc', 'resting', 'dir', 'food', 'pos', 'alive')

    def __init__(self, i, colony, pos):
        self.id, self.colony, self.pc, self.resting, self.dir, self.food, self.pos, self.alive = i, colony, 0, 0, 0, 0, pos, True


class World:
    def __init__(self, text, programs, seed, wrap, rules=None):
        self.rules = rules or RULESETS['classic']
        missing = [k for k, v in self.rules.items() if v != IMPLEMENTED[k]]
        if missing:
            raise NotImplementedError('ruleset needs features not implemented yet: ' + ', '.join(missing))
        self.w, self.h, self.rock, self.food, self.base = parse_map(text)
        self.wrap, self.progs, self.rng, self.round = wrap, programs, Rng(seed), 0
        self.ncol = len(programs)
        n = self.w * self.h
        self.grid = [None] * n
        self.marks = [[0] * n for _ in range(self.ncol)]
        self.ants = []
        for p in range(n):  # ids: left-to-right, top-to-bottom across the whole map
            if p in self.base:
                a = Ant(len(self.ants), self.base[p], p)
                self.ants.append(a)
                self.grid[p] = a

    def adjacent(self, p, d):
        x, y = p % self.w, p // self.w
        even = y % 2 == 0
        dx, dy = {0: (1, 0), 1: (0, 1) if even else (1, 1), 2: (-1, 1) if even else (0, 1), 3: (-1, 0),
                  4: (-1, -1) if even else (0, -1), 5: (0, -1) if even else (1, -1)}[d]
        x, y = x + dx, y + dy
        if self.wrap:
            x, y = (x + self.w) % self.w, (y + self.h) % self.h
        elif not (0 <= x < self.w and 0 <= y < self.h):
            return None
        return y * self.w + x

    def obstructed(self, p):
        return p is None or p in self.rock

    def matches(self, p, cond, i, colony):
        if self.obstructed(p):
            return cond == 'rock'  # obstructed: only rock matches
        a = self.grid[p]
        if cond == 'rock':
            return False
        if cond == 'friend':
            return a is not None and a.colony == colony
        if cond == 'foe':
            return a is not None and a.colony != colony
        if cond == 'friendwithfood':
            return a is not None and a.colony == colony and a.food > 0
        if cond == 'foewithfood':
            return a is not None and a.colony != colony and a.food > 0
        if cond == 'food':
            return self.food.get(p, 0) > 0
        if cond == 'marker':
            return (self.marks[colony][p] >> i) & 1 == 1
        if cond == 'foemarker':
            return any(self.marks[c][p] != 0 for c in range(self.ncol) if c != colony)
        if cond == 'home':
            return self.base.get(p) == colony
        if cond == 'foehome':
            return p in self.base and self.base[p] != colony
        raise ValueError(cond)

    def enemies_around(self, p, colony):
        n = 0
        for d in range(6):
            q = self.adjacent(p, d)
            a = None if q is None else self.grid[q]
            if a is not None and a.colony != colony:
                n += 1
        return n

    def act_if_surrounded(self, p):
        a = None if p is None else self.grid[p]
        if a is not None and self.enemies_around(p, a.colony) >= 5:
            self.grid[p] = None
            a.alive = False
            self.food[p] = self.food.get(p, 0) + 3 + a.food
            a.food = 0

    def step(self, a):
        if not a.alive:
            return
        if a.resting > 0:
            a.resting -= 1
            return
        ins, p = self.progs[a.colony][a.pc], a.pos
        op = ins[0]
        if op == 'sense':
            _, sensing, st1, st2, cond, i = ins
            d = {'here': None, 'ahead': a.dir, 'leftahead': (a.dir + 5) % 6, 'rightahead': (a.dir + 1) % 6}[sensing]
            q = p if d is None else self.adjacent(p, d)
            a.pc = st1 if self.matches(q, cond, i, a.colony) else st2
        elif op == 'mark':
            self.marks[a.colony][p] |= 1 << ins[1]
            a.pc = ins[2]
        elif op == 'unmark':
            self.marks[a.colony][p] &= ~(1 << ins[1])
            a.pc = ins[2]
        elif op == 'pickup':
            if a.food >= self.rules['cap'] or self.food.get(p, 0) == 0:  # CAP = 1 in Classic
                a.pc = ins[2]
            else:
                self.food[p] -= 1
                a.food += 1
                a.pc = ins[1]
        elif op == 'drop':
            self.food[p] = self.food.get(p, 0) + a.food
            a.food = 0
            a.pc = ins[1]
        elif op == 'turn':
            a.dir = (a.dir + (5 if ins[1] == 'left' else 1)) % 6
            a.pc = ins[2]
        elif op == 'move':
            q = self.adjacent(p, a.dir)
            if self.obstructed(q) or self.grid[q] is not None:
                a.pc = ins[2]
            else:
                self.grid[p] = None
                self.grid[q] = a
                a.pos = q
                a.resting = 14
                self.act_if_surrounded(q)  # destination, then its six neighbours
                for d in range(6):
                    self.act_if_surrounded(self.adjacent(q, d))
                a.pc = ins[1]
        elif op == 'flip':
            a.pc = ins[2] if self.rng.randomint(ins[1]) == 0 else ins[3]

    def run_round(self):
        self.round += 1
        for a in self.ants:
            self.step(a)

    def state_bytes(self):
        out = [struct.pack('<III', self.round, self.rng.s, self.rng.draws)]
        for p in range(self.w * self.h):
            out.append(struct.pack('<H', self.food.get(p, 0)))
            out.extend(struct.pack('<B', self.marks[c][p]) for c in range(self.ncol))
            out.append(struct.pack('<h', self.grid[p].id if self.grid[p] else -1))
        for a in self.ants:
            if a.alive:
                out.append(struct.pack('<BBHBHBB', 1, a.colony, a.pos, a.dir, a.pc, a.food, a.resting))
            else:  # dead: cell 0xFFFF, other fields 0
                out.append(struct.pack('<BBHBHBB', 0, a.colony, 0xFFFF, 0, 0, 0, 0))
        return b''.join(out)

    def hash(self):
        h = 0x811C9DC5
        for b in self.state_bytes():
            h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
        return h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map', required=True)
    ap.add_argument('--ant', action='append', required=True)
    ap.add_argument('--rounds', type=int, default=100000)
    ap.add_argument('--seed', type=int, default=12345)
    ap.add_argument('--every', type=int, default=0)
    ap.add_argument('--no-wrap', action='store_true')
    o = ap.parse_args()
    progs = [parse_ant(open(f).read()) for f in o.ant]
    if len(progs) == 1:
        progs = progs * 2
    world = World(open(o.map).read(), progs, o.seed, not o.no_wrap)
    for r in range(1, o.rounds + 1):
        world.run_round()
        if o.every and r % o.every == 0:
            print(json.dumps({'round': r, 'hash': world.hash()}))
    print(json.dumps({'round': world.round, 'hash': world.hash(), 'final': True}))


if __name__ == '__main__':
    main()
