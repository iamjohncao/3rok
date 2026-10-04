"""The 3rok CCSDS OEM 3.0 profile, in plain Python.

This is the same check as ``lib/oem.ts`` (docs/flight-algorithm-oem.md). It reads text and
says whether it is a valid 3rok OEM. It has no imports from this repository and does not
touch the physics package: ``validate_oem`` and ``submit_oem`` are pure checks of text.

The two validators must not drift. ``fixtures/oem-profile-cases.json`` is the shared case
list, and each case carries the exact ``validate_oem`` result. ``lib/oem.test.ts`` and
``tests/test_oem_profile.py`` both compare against it, sentence for sentence. A change to a
rule or to an error sentence is made in both files, then ``scripts/update-oem-golden.mjs``
rewrites the expected results, and the diff is reviewed.

Behavior that follows JavaScript and not Python on purpose, so both read a file the same
way: ``\\d`` is ASCII only, whitespace is JavaScript's set, and ``.`` stops at ``\\r``,
``\\u2028`` and ``\\u2029``.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

OEM_VERSION = "3.0"
OEM_ORIGINATOR = "3ROK"
OEM_CENTER_NAME = "EARTH"
OEM_REF_FRAME = "GCRF"
OEM_TIME_SYSTEM = "UTC"

# JavaScript's \s and String.prototype.trim: not Python's (which adds \x1c-\x1f and \x85
# and leaves out the byte-order mark).
_WS_CHARS = "\f\n\r\t\v                  　﻿"
_WS = "[" + _WS_CHARS.replace("\\", "\\\\") + "]"
_NOT_LINE_END = "[^\n\r  ]"


def _trim(text: str) -> str:
    return text.strip(_WS_CHARS)


_CALENDAR_EPOCH = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?", re.ASCII)
_DAY_OF_YEAR_EPOCH = re.compile(r"(\d{4})-(\d{3})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?", re.ASCII)

_DAYS_IN_MONTH = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _is_leap_year(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def _days_from_civil(year: int, month: int, day: int) -> int:
    """Days since 1970-01-01 in the proleptic Gregorian calendar, for any year including 0."""
    y = year - (1 if month <= 2 else 0)
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def epoch_to_seconds(epoch: str) -> float | None:
    """Seconds since 1970-01-01T00:00:00Z for ``YYYY-MM-DDThh:mm:ss[.fff][Z]`` or
    ``YYYY-DDDThh:mm:ss[.fff][Z]``. None when the text is not a real instant. Leap seconds
    (second 60) are not supported."""
    calendar = _CALENDAR_EPOCH.fullmatch(epoch)
    if calendar:
        year, month, day = int(calendar[1]), int(calendar[2]), int(calendar[3])
        hour, minute, second = int(calendar[4]), int(calendar[5]), int(calendar[6])
        fraction = calendar[7]
        if month < 1 or month > 12:
            return None
        days_in_month = _DAYS_IN_MONTH[month - 1] + (1 if month == 2 and _is_leap_year(year) else 0)
        if day < 1 or day > days_in_month:
            return None
        days = _days_from_civil(year, month, day)
    else:
        ordinal = _DAY_OF_YEAR_EPOCH.fullmatch(epoch)
        if not ordinal:
            return None
        year, day = int(ordinal[1]), int(ordinal[2])
        hour, minute, second = int(ordinal[3]), int(ordinal[4]), int(ordinal[5])
        fraction = ordinal[6]
        if day < 1 or day > (366 if _is_leap_year(year) else 365):
            return None
        days = _days_from_civil(year, 1, 1) + day - 1
    if hour > 23 or minute > 59 or second > 59:
        return None
    return days * 86400 + hour * 3600 + minute * 60 + second + (float(f"0{fraction}") if fraction else 0.0)


_HEADER_KEYWORDS = ("CCSDS_OEM_VERS", "CLASSIFICATION", "CREATION_DATE", "ORIGINATOR", "MESSAGE_ID")

# The standard's order. Optional keywords may be missing, but never out of place.
_METADATA_KEYWORDS = (
    "OBJECT_NAME",
    "OBJECT_ID",
    "CENTER_NAME",
    "REF_FRAME",
    "REF_FRAME_EPOCH",
    "TIME_SYSTEM",
    "START_TIME",
    "USEABLE_START_TIME",
    "USEABLE_STOP_TIME",
    "STOP_TIME",
    "INTERPOLATION",
    "INTERPOLATION_DEGREE",
)

_REQUIRED_METADATA = (
    "OBJECT_NAME",
    "OBJECT_ID",
    "CENTER_NAME",
    "REF_FRAME",
    "TIME_SYSTEM",
    "START_TIME",
    "STOP_TIME",
)

_COMMENT_LINE = re.compile(rf"COMMENT(?:{_WS}+({_NOT_LINE_END}*))?")
_KEYWORD_LINE = re.compile(rf"([A-Z][A-Z0-9_]*){_WS}*={_WS}*({_NOT_LINE_END}*)")
_NUMBER = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", re.ASCII)
_EPOCH_LIKE = re.compile(r"\d{4}-", re.ASCII)
_WHOLE_NUMBER = re.compile(r"\d+", re.ASCII)
_SPLIT_WS = re.compile(f"{_WS}+")

_EPOCH_EXAMPLE = "2026-10-03T18:05:00.000"


@dataclass
class Issue:
    message: str
    line: int | None = None


def format_issue(issue: Issue) -> str:
    return issue.message if issue.line is None else f"Line {issue.line}: {issue.message}"


@dataclass
class State:
    epoch: str
    time: float
    has_acceleration: bool


@dataclass
class Segment:
    start_time: str = ""
    stop_time: str = ""
    use_start: str | None = None
    use_stop: str | None = None
    states: list[State] = field(default_factory=list)


@dataclass
class _Source:
    n: int
    text: str


def _source_lines(text: str) -> list[_Source]:
    lines = []
    for index, raw in enumerate(re.split(r"\r?\n", text.removeprefix("﻿"))):
        trimmed = _trim(raw)
        if trimmed != "":
            lines.append(_Source(index + 1, trimmed))
    return lines


def _clip(text: str) -> str:
    return f"{text[:57]}..." if len(text) > 60 else text


def _read(text: str, this_app_wrote: bool) -> tuple[list[Segment], list[Issue]]:
    issues: list[Issue] = []
    segments: list[Segment] = []

    def fail(message: str, line: int | None = None) -> None:
        issues.append(Issue(message, line))

    lines = _source_lines(text)
    i = 0

    if not lines:
        fail("The file is empty. An OEM starts with CCSDS_OEM_VERS = 3.0.")
        return segments, issues

    # --- Header ---------------------------------------------------------------------
    header_seen: set[str] = set()
    header_rank = -1
    while i < len(lines) and lines[i].text != "META_START":
        line = lines[i]
        i += 1

        comment = _COMMENT_LINE.fullmatch(line.text)
        if comment:
            allowed = (
                "CCSDS_OEM_VERS" in header_seen
                and "CLASSIFICATION" not in header_seen
                and "CREATION_DATE" not in header_seen
            )
            if not allowed:
                fail("COMMENT lines in the header must come directly after CCSDS_OEM_VERS.", line.n)
            continue

        pair = _KEYWORD_LINE.fullmatch(line.text)
        if not pair:
            fail(f'This is not a KEYWORD = value line: "{_clip(line.text)}".', line.n)
            continue
        key = pair[1]
        value = _trim(pair[2])
        rank = _HEADER_KEYWORDS.index(key) if key in _HEADER_KEYWORDS else -1

        if rank == -1:
            fail(
                f"{key} belongs between META_START and META_STOP, not in the header."
                if key in _METADATA_KEYWORDS
                else f"{key} is not an OEM header keyword. The header keywords are {', '.join(_HEADER_KEYWORDS)}.",
                line.n,
            )
            continue
        if key in header_seen:
            fail(f"{key} appears more than once in the header.", line.n)
            continue
        if rank < header_rank:
            fail(f"{key} is out of order. Header keywords go in this order: {', '.join(_HEADER_KEYWORDS)}.", line.n)
        header_rank = max(header_rank, rank)
        header_seen.add(key)

        if key == "CCSDS_OEM_VERS":
            if value != OEM_VERSION:
                fail(f"CCSDS_OEM_VERS must be {OEM_VERSION}, but this file says {value or 'nothing'}.", line.n)
        elif key == "CREATION_DATE":
            if epoch_to_seconds(value) is None:
                fail(
                    f'CREATION_DATE must be a UTC timestamp such as 2026-10-03T18:00:00, but this file says "{_clip(value)}".',
                    line.n,
                )
        elif key == "ORIGINATOR":
            if value == "":
                fail("ORIGINATOR must not be empty.", line.n)
            elif this_app_wrote and value != OEM_ORIGINATOR:
                fail(
                    f"ORIGINATOR must be {OEM_ORIGINATOR} on a file this app writes, but this file says {_clip(value)}. Do not use another agency's name.",
                    line.n,
                )

    if "CCSDS_OEM_VERS" not in header_seen:
        fail(f"CCSDS_OEM_VERS = {OEM_VERSION} is required at the top of the file.")
    if "CREATION_DATE" not in header_seen:
        fail("CREATION_DATE is required in the header.")
    if "ORIGINATOR" not in header_seen:
        fail("ORIGINATOR is required in the header.")
    if i >= len(lines):
        fail("The file has no META_START block, so it has no trajectory.")
        return segments, issues

    # --- Segments -------------------------------------------------------------------
    while i < len(lines):
        opening = lines[i]
        i += 1  # META_START
        segment = Segment()
        where = f"(segment {len(segments) + 1})"
        segments.append(segment)

        # Metadata block
        meta_seen: set[str] = set()
        meta_rank = -1
        closed = False
        while i < len(lines):
            line = lines[i]
            if line.text == "META_STOP":
                closed = True
                i += 1
                break
            if line.text == "META_START":
                break
            if _EPOCH_LIKE.match(line.text) and not _KEYWORD_LINE.fullmatch(line.text):
                fail(f"META_STOP is missing: state lines begin here {where}.", line.n)
                closed = True
                break  # leave the line for the data section
            i += 1

            comment = _COMMENT_LINE.fullmatch(line.text)
            if comment:
                if meta_seen:
                    fail(f"COMMENT lines in a metadata block must come directly after META_START {where}.", line.n)
                continue

            pair = _KEYWORD_LINE.fullmatch(line.text)
            if not pair:
                fail(f'This is not a KEYWORD = value line: "{_clip(line.text)}" {where}.', line.n)
                continue
            key = pair[1]
            value = _trim(pair[2])
            rank = _METADATA_KEYWORDS.index(key) if key in _METADATA_KEYWORDS else -1

            if rank == -1:
                fail(f"{key} is not an OEM metadata keyword {where}.", line.n)
                continue
            if key in meta_seen:
                fail(f"{key} appears more than once in the metadata block {where}.", line.n)
                continue
            if rank < meta_rank:
                fail(
                    f"{key} is out of order. Metadata keywords go in this order: {', '.join(_METADATA_KEYWORDS)} {where}.",
                    line.n,
                )
            meta_rank = max(meta_rank, rank)
            meta_seen.add(key)

            if key == "OBJECT_NAME":
                if value == "":
                    fail(f"OBJECT_NAME must not be empty {where}.", line.n)
            elif key == "OBJECT_ID":
                if value == "":
                    fail(f"OBJECT_ID must not be empty; use UNKNOWN {where}.", line.n)
            elif key == "CENTER_NAME":
                if value != OEM_CENTER_NAME:
                    fail(f"CENTER_NAME must be {OEM_CENTER_NAME}, but this file says {_clip(value) or 'nothing'} {where}.", line.n)
            elif key == "REF_FRAME":
                if value != OEM_REF_FRAME:
                    fail(f"REF_FRAME must be {OEM_REF_FRAME}, but this file says {_clip(value) or 'nothing'} {where}.", line.n)
            elif key == "REF_FRAME_EPOCH":
                fail(
                    f"REF_FRAME_EPOCH must be omitted. REF_FRAME is {OEM_REF_FRAME}, which has a fixed definition and takes no epoch {where}.",
                    line.n,
                )
            elif key == "TIME_SYSTEM":
                if value != OEM_TIME_SYSTEM:
                    fail(f"TIME_SYSTEM must be {OEM_TIME_SYSTEM}, but this file says {_clip(value) or 'nothing'} {where}.", line.n)
            elif key in ("START_TIME", "STOP_TIME", "USEABLE_START_TIME", "USEABLE_STOP_TIME"):
                if key == "START_TIME":
                    segment.start_time = value
                elif key == "STOP_TIME":
                    segment.stop_time = value
                elif key == "USEABLE_START_TIME":
                    segment.use_start = value
                else:
                    segment.use_stop = value
                if epoch_to_seconds(value) is None:
                    fail(
                        f'{key} must be a UTC timestamp such as {_EPOCH_EXAMPLE}, but this file says "{_clip(value)}" {where}.',
                        line.n,
                    )
            elif key == "INTERPOLATION":
                if value == "":
                    fail(f"INTERPOLATION must not be empty {where}.", line.n)
            elif key == "INTERPOLATION_DEGREE":
                if not (_WHOLE_NUMBER.fullmatch(value) and int(value) >= 1):
                    fail(
                        f'INTERPOLATION_DEGREE must be a whole number of 1 or more, but this file says "{_clip(value)}" {where}.',
                        line.n,
                    )

        if not closed:
            fail(f"The metadata block that starts at META_START never reaches META_STOP {where}.", opening.n)
            continue

        for key in _REQUIRED_METADATA:
            if key not in meta_seen:
                fail(f"{key} is required in every metadata block {where}.", opening.n)
        if "INTERPOLATION" in meta_seen and "INTERPOLATION_DEGREE" not in meta_seen:
            fail(f"INTERPOLATION_DEGREE is required when INTERPOLATION is present {where}.", opening.n)

        # Data section
        state_lines: list[int] = []
        skipping_covariance = False
        while i < len(lines) and lines[i].text != "META_START":
            line = lines[i]
            i += 1

            if skipping_covariance:
                if line.text == "COVARIANCE_STOP":
                    skipping_covariance = False
                continue
            if line.text == "COVARIANCE_START":
                fail(f"COVARIANCE blocks are not part of the 3rok profile. Remove the covariance data {where}.", line.n)
                skipping_covariance = True
                continue

            comment = _COMMENT_LINE.fullmatch(line.text)
            if comment:
                if segment.states:
                    fail(f"COMMENT lines in the data section must come before the first state line {where}.", line.n)
                continue

            tokens = _SPLIT_WS.split(line.text)
            values = tokens[1:]
            if len(values) not in (6, 9):
                fail(
                    f"A state line holds an epoch and then 6 numbers (position and velocity) or 9 numbers (with acceleration), but this line has {len(values)} {where}.",
                    line.n,
                )
                continue
            time = epoch_to_seconds(tokens[0])
            good = True
            if time is None:
                fail(f'"{_clip(tokens[0])}" is not a valid UTC epoch. Use a form like {_EPOCH_EXAMPLE} {where}.', line.n)
                good = False
            for token in values:
                parsed = float(token) if _NUMBER.fullmatch(token) else math.nan
                if not math.isfinite(parsed):
                    fail(f'"{_clip(token)}" is not a number. State lines hold km, km/s, and km/s^2 values {where}.', line.n)
                    good = False
            if not good or time is None:
                continue

            segment.states.append(State(tokens[0], time, len(values) == 9))
            state_lines.append(line.n)

        # Checks that need the whole segment.
        states = segment.states
        if not states:
            fail(f"There are no state lines after META_STOP {where}.", opening.n)
            continue

        with_acceleration = states[0].has_acceleration
        mixed = next((k for k, s in enumerate(states) if s.has_acceleration != with_acceleration), -1)
        if mixed != -1:
            if with_acceleration:
                message = f"Acceleration must be on every state line of a segment or on none, but line {state_lines[0]} has it and line {state_lines[mixed]} does not {where}."
            else:
                message = f"Acceleration must be on every state line of a segment or on none, but line {state_lines[mixed]} has it and line {state_lines[0]} does not {where}."
            fail(message, state_lines[mixed])

        for k in range(1, len(states)):
            if states[k].time <= states[k - 1].time:
                fail(
                    f"Epochs in a segment must increase, but {states[k].epoch} on line {state_lines[k]} is not later than {states[k - 1].epoch} on line {state_lines[k - 1]} {where}.",
                    state_lines[k],
                )
                break

        first, last = states[0], states[-1]
        start = epoch_to_seconds(segment.start_time)
        stop = epoch_to_seconds(segment.stop_time)
        if start is not None and start != first.time:
            fail(
                f"START_TIME must match the first state's epoch, but START_TIME is {segment.start_time} and the first state is at {first.epoch} {where}.",
                opening.n,
            )
        if stop is not None and stop != last.time:
            fail(
                f"STOP_TIME must match the last state's epoch, but STOP_TIME is {segment.stop_time} and the last state is at {last.epoch} {where}.",
                opening.n,
            )
        usable_start = epoch_to_seconds(segment.use_start) if segment.use_start else None
        usable_stop = epoch_to_seconds(segment.use_stop) if segment.use_stop else None
        if start is not None and stop is not None:
            for key, value in (("USEABLE_START_TIME", usable_start), ("USEABLE_STOP_TIME", usable_stop)):
                if value is not None and (value < start or value > stop):
                    fail(f"{key} must fall between START_TIME and STOP_TIME {where}.", opening.n)
        if usable_start is not None and usable_stop is not None and usable_start > usable_stop:
            fail(f"USEABLE_START_TIME must not be later than USEABLE_STOP_TIME {where}.", opening.n)

    total = sum(len(s.states) for s in segments)
    if total < 2:
        fail(f"An OEM needs at least two state lines so the path has a start and an end, but this file has {total}.")

    issues.sort(key=lambda issue: issue.line if issue.line is not None else 2**53 - 1)
    return segments, issues


def validate_oem(text: str, this_app_wrote: bool = True) -> dict[str, Any]:
    """The ``validate_oem`` tool result, the same shape as ``validateOem`` in ``lib/oem.ts``.

    A file Grok submits is a file this app writes, so ORIGINATOR must be 3ROK. The shared
    cases say per case whether that rule applies.
    """
    segments, issues = _read(text, this_app_wrote)
    return {
        "valid": not issues,
        "errors": [format_issue(issue) for issue in issues],
        "segment_count": len(segments),
        "state_count": sum(len(s.states) for s in segments),
        "start_time": (segments[0].start_time or None) if segments else None,
        "stop_time": (segments[-1].stop_time or None) if segments else None,
        "has_acceleration": any(state.has_acceleration for s in segments for state in s.states),
    }
