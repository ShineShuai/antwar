#!/usr/bin/env python3
"""Run spec/micro-tests.json against the Python second implementation: python3 oracle/micro.py [file]"""
import json
import sys

from ref import World, parse_ant


def check_case(case):
    progs = [parse_ant(t) for t in case['ants']]
    w = World(case['map'], progs, case.get('seed', 12345), case.get('wrap', True))
    errors = []
    for chk in sorted(case['checks'], key=lambda c: c['round']):
        while w.round < chk['round']:
            w.run_round()
        for e in chk.get('ants', []):
            a = w.ants[e['id']]
            got = {'alive': a.alive, 'x': a.pos % w.w, 'y': a.pos // w.w, 'dir': a.dir, 'pc': a.pc, 'food': a.food, 'rest': a.resting}
            if not a.alive:
                got.update(x=None, y=None)
            for k, v in e.items():
                if k != 'id' and got[k] != v:
                    errors.append('round %d ant %d %s: expected %r, got %r' % (chk['round'], e['id'], k, v, got[k]))
        for e in chk.get('cells', []):
            p = e['y'] * w.w + e['x']
            if 'food' in e and w.food.get(p, 0) != e['food']:
                errors.append('round %d cell (%d,%d) food: expected %r, got %r' % (chk['round'], e['x'], e['y'], e['food'], w.food.get(p, 0)))
            if 'marks' in e and [w.marks[c][p] for c in range(w.ncol)] != e['marks']:
                errors.append('round %d cell (%d,%d) marks: expected %r, got %r' % (chk['round'], e['x'], e['y'], e['marks'], [w.marks[c][p] for c in range(w.ncol)]))
        if 'draws' in chk and w.rng.draws != chk['draws']:
            errors.append('round %d draws: expected %r, got %r' % (chk['round'], chk['draws'], w.rng.draws))
    return errors


def main():
    data = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'spec/micro-tests.json'))
    failed = 0
    for case in data['cases']:
        errs = check_case(case)
        print(('FAIL ' if errs else 'ok   ') + case['name'])
        for e in errs:
            print('     ' + e)
        failed += bool(errs)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
