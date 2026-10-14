from __future__ import annotations

from model import Input, Record

VALID_KINDS = {"exact", "proxy", "estimate"}


def validate_records(records: list[Record]) -> None:
    for rec in records:
        if rec.kind not in VALID_KINDS:
            raise ValueError(
                f"{rec.source_id}: unknown kind {rec.kind!r}; "
                f"expected one of {sorted(VALID_KINDS)}"
            )
        if rec.kind == "estimate":
            if not rec.formula:
                raise ValueError(f"{rec.source_id}: estimate has no formula")
            if not rec.inputs:
                raise ValueError(f"{rec.source_id}: estimate has no inputs")
        for i in rec.inputs or []:
            d = i.to_dict() if isinstance(i, Input) else i
            if not d.get("source_id"):
                raise ValueError(f"{rec.source_id}: input missing source_id")
            if not d.get("verify_url"):
                raise ValueError(
                    f"{rec.source_id}: input {d.get('source_id')!r} missing verify_url"
                )
