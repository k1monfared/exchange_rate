from __future__ import annotations

# Jalali (Persian) <-> Gregorian conversion, ported from jalaali-js (MIT).

BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635,
          2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]


def tdiv(a: int, b: int) -> int:
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q


def tmod(a: int, b: int) -> int:
    return a - tdiv(a, b) * b


def _jal_cal(jy: int) -> dict:
    bl = len(BREAKS)
    gy = jy + 621
    leap_j = -14
    jp = BREAKS[0]
    jump = 0
    if jy < jp or jy >= BREAKS[bl - 1]:
        raise ValueError(f"invalid jalali year {jy}")
    for i in range(1, bl):
        jm = BREAKS[i]
        jump = jm - jp
        if jy < jm:
            break
        leap_j = leap_j + tdiv(jump, 33) * 8 + tdiv(tmod(jump, 33), 4)
        jp = jm
    n = jy - jp
    leap_j = leap_j + tdiv(n, 33) * 8 + tdiv(tmod(n, 33) + 3, 4)
    if tmod(jump, 33) == 4 and jump - n == 4:
        leap_j += 1
    leap_g = tdiv(gy, 4) - tdiv((tdiv(gy, 100) + 1) * 3, 4) - 150
    march = 20 + leap_j - leap_g
    if jump - n < 6:
        n = n - jump + tdiv(jump + 4, 33) * 33
    leap = tmod(tmod(n + 1, 33) - 1, 4)
    if leap == -1:
        leap = 4
    return {"leap": leap, "gy": gy, "march": march}


def _g2d(gy: int, gm: int, gd: int) -> int:
    d = (tdiv((gy + tdiv(gm - 8, 6) + 100100) * 1461, 4)
         + tdiv(153 * tmod(gm + 9, 12) + 2, 5) + gd - 34840408)
    d = d - tdiv(tdiv(gy + 100100 + tdiv(gm - 8, 6), 100) * 3, 4) + 752
    return d


def _d2g(jdn: int) -> dict:
    j = 4 * jdn + 139361631
    j = j + tdiv(tdiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    i = tdiv(tmod(j, 1461), 4) * 5 + 308
    gd = tdiv(tmod(i, 153), 5) + 1
    gm = tmod(tdiv(i, 153), 12) + 1
    gy = tdiv(j, 1461) - 100100 + tdiv(8 - gm, 6)
    return {"gy": gy, "gm": gm, "gd": gd}


def _j2d(jy: int, jm: int, jd: int) -> int:
    r = _jal_cal(jy)
    return _g2d(r["gy"], 3, r["march"]) + (jm - 1) * 31 - tdiv(jm, 7) * (jm - 7) + jd - 1


def jalaali_to_gregorian(jy: int, jm: int, jd: int) -> tuple[int, int, int]:
    g = _d2g(_j2d(jy, jm, jd))
    return g["gy"], g["gm"], g["gd"]


def jalaali_to_iso(jy: int, jm: int, jd: int) -> str:
    gy, gm, gd = jalaali_to_gregorian(jy, jm, jd)
    return f"{gy:04d}-{gm:02d}-{gd:02d}"
