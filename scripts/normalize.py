def to_rial(value: float, unit: str) -> int:
    if unit == "rial":
        return int(round(value))
    if unit == "toman":
        return int(round(value * 10))
    raise ValueError(f"unknown unit: {unit}")


def to_toman(value_rial: int) -> float:
    return value_rial / 10
