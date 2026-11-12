"""Offline, deterministic website data build from a verified fixed evidence snapshot.

No name-only identity joins. Each raw exam is linked to a canonical UID record.
Only earlier, complete teacher lists in the same school year permit automatic propagation.
"""
import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import unicodedata
import uuid
from collections import Counter, defaultdict
from decimal import Decimal
from itertools import groupby
from pathlib import Path
from urllib.parse import quote, urlsplit

import pypinyin

from scoring import SCORING_VERSION, WEIGHTS, competition_ranks, contribution, rank_coefficient

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data/baseline'
CURATED = ROOT / 'data/curated'
PROVINCES = '安徽 北京 福建 甘肃 广东 广西 贵州 海南 河北 河南 黑龙江 湖北 湖南 吉林 江苏 江西 辽宁 内蒙古 山东 山西 陕西 上海 四川 天津 新疆 浙江 重庆 宁夏 云南 澳门 香港 青海 西藏 台湾'.split()
AWARDS = ['金牌', '银牌', '铜牌', '一等奖', '二等奖', '三等奖', '国际金牌', '国际银牌', '国际铜牌', '前5%', '前15%', '前25%']
TYPES = ['NOI', 'NOIP提高', 'CTSC', 'APIO', 'NOID类', 'IOI', 'NOIP普及', 'WC', 'CSP提高', 'CSP入门', 'NOIP', 'NGOI', 'NOIST', 'WC-AI']
SUPPORTED = set(WEIGHTS) | {'WC-AI', 'APIO-online'}
ATTRIBUTION_VERSION = 'school-year-chronological-v2'
CONTEST_ORDER = {'WC': 0, 'WC-AI': 0, 'APIO': 1, 'APIO-online': 1,
                 'NOI': 2, 'NOID类': 2, 'IOI': 3, 'NOIP': 4, 'NOIP提高': 4, 'NOIP普及': 4}


def normalized(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(value or '')))


def normalized_province(value):
    return {'澳門': '澳门', '內蒙古': '内蒙古'}.get(value, value)


def atomic_replace(source, destination):
    # Windows virus scanners and file watchers may briefly hold an open handle.
    for attempt in range(20):
        try:
            os.replace(source, destination)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(.25)


def stage_of(grade):
    grade = normalized(grade)
    if any(marker in grade for marker in ['/', '无', '未知', '新']):
        return 'unknown'
    if grade.startswith(('初', '七年', '八年', '九年')) or grade in ['中一', '中二', '中三']:
        return 'junior'
    if grade.startswith('高') or grade in ['中四', '中五', '中六']:
        return 'senior'
    if grade.startswith('小') or grade in ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级']:
        return 'primary'
    return 'unknown'


def name_initials(name, surnames):
    if re.fullmatch(r"[a-zA-Z .'-]+", name):
        return ''.join(word[0].lower() for word in re.findall(r'[a-zA-Z]+', name))
    letters = pypinyin.lazy_pinyin(name, style=pypinyin.Style.FIRST_LETTER)
    for length in range(len(name), 0, -1):
        if name[:length] in surnames:
            letters[:length] = surnames[name[:length]]
    return re.sub('[^a-z]', '', ''.join(letters).lower())


def number(value):
    if value in ('', None):
        return ''
    return str(Decimal(str(value)).normalize())


def read_baseline(name, manifest):
    content = gzip.decompress((BASE / (name + '.gz')).read_bytes())
    expected = manifest['files'][name]
    if hashlib.sha256(content).hexdigest() != expected['sha256'] or len(content) != expected['bytes']:
        raise ValueError(f'Baseline integrity failure: {name}')
    return content.decode('utf-8-sig')


def contest_kind(record):
    event = record['event']
    if event == 'APIO' and record['variant'] == 'online':
        return 'APIO-online'
    if event == 'NOI' and record['variant'] != 'main':
        return 'NOID类' if record['variant'] in ['invitational', 'summer'] else None
    if event == 'WC' and record['variant'] != 'main':
        return 'WC-AI' if record['variant'] == 'ai' else None
    if record['variant'] != 'main':
        return None
    if event == 'NOIP':
        return {'提高组': 'NOIP提高', '普及组': 'NOIP普及'}.get(record['group'], 'NOIP')
    return event


def load_upstream(manifest):
    static = json.loads(read_baseline('static.json', manifest))
    configs = json.loads(read_baseline('contests.json', manifest))
    config_map = {c['name']: c for c in configs}
    raw_by_key = defaultdict(list)
    counts = Counter()
    previous_raw = {}
    for line in read_baseline('raw.txt', manifest).splitlines():
        if not line or line.startswith('#'):
            continue
        cells = line.split(',')
        if len(cells) != 9:
            continue
        contest, award, name, grade, school, score, province, _, _ = cells
        counts[contest] += 1
        explicit = re.fullmatch(r'(\d+(?:\.\d+)?)\(rk(\d+)\)', score)
        basis = 'explicit' if explicit else 'score' if score else 'list'
        score_value = number(explicit[1] if explicit else score)
        previous = previous_raw.get(contest)
        rank = int(explicit[2]) if explicit else previous['rank'] if score and previous and previous['score'] == score_value else counts[contest]
        raw = {'grade': grade, 'school': school, 'award': award, 'score': score_value, 'rank': rank,
               'rankBasis': basis, 'ordinal': counts[contest], 'name': name, 'province': province}
        raw_by_key[contest, name, province].append(raw)
        previous_raw[contest] = raw
    # Verify that the UID snapshot's competition metadata agrees with the pinned source.
    for contest in static['contests']:
        expected = config_map.get(contest['name'])
        if expected is None or expected['year'] != contest['year'] or expected['type'] != TYPES[contest['type']]:
            raise ValueError('Canonical UID snapshot and pinned contests are incompatible')
    records, by_lookup, students = {}, defaultdict(list), {}
    for line in read_baseline('result.txt', manifest).splitlines():
        uid, initials, name, gender, enrollment, _, _, _, packed = line.split(',', 8)
        sid = 'oier-' + uid
        students[sid] = {'id': sid, 'uid': int(uid), 'name': name, 'initials': initials, 'identityStatus': 'confirmed'}
        for packed_record in packed.split('/'):
            fields = packed_record.split(';')[0].split(':')
            cid, school_id, score, rank, province_index, award_index = fields[:6]
            c = static['contests'][int(cid)]
            kind = TYPES[c['type']]
            if kind == 'APIO' and '线上' in c['name']:
                kind = 'APIO-online'
            if kind not in SUPPORTED:
                continue
            province = PROVINCES[int(province_index)]
            candidate_raw = raw_by_key[c['name'], name, province]
            score_key = number(score)
            raw_matches = [r for r in candidate_raw if r['score'] == score_key]
            if len(raw_matches) != 1:
                raw_matches = [r for r in raw_matches if normalized(r['school']) == normalized(static['schools'][int(school_id)][0])]
            raw = raw_matches[0] if len(raw_matches) == 1 else None
            rid = f'oier-{uid}-{cid}'
            config = config_map[c['name']]
            total = config.get('capacity') or counts[c['name']]
            # Unknown raw-grade provenance stays unknown rather than borrowing a person's age.
            grade = raw['grade'] if raw else ''
            scoring_ready = raw is not None and raw['rank'] == int(rank) and total > 0
            record = {
                'id': rid, 'studentId': sid, 'contest': c['name'], 'event': 'NOIP' if kind.startswith('NOIP') else 'NOI' if kind == 'NOID类' else 'WC' if kind == 'WC-AI' else 'APIO' if kind == 'APIO-online' else kind,
                'contestType': kind, 'year': c['year'], 'schoolYear': c['year'] - (not c['fall_semester']),
                'province': province, 'school': raw['school'] if raw else static['schools'][int(school_id)][0],
                'grade': grade, 'stage': stage_of(grade), 'award': AWARDS[int(award_index)], 'examScore': score,
                'rank': int(rank), 'population': total, 'rankBasis': raw['rankBasis'] if scoring_ready else 'pending',
                'populationBasis': 'capacity' if config.get('capacity') else 'complete-records',
                'eligible': True, 'core': kind in WEIGHTS, 'score': None,
                'sourceIds': ['oierdb'], 'evidence': [], 'originIds': [], 'teacherSets': [], 'directCoaches': [],
                'incompleteEvidence': False, 'scoringVersion': SCORING_VERSION,
            }
            if record['core'] and scoring_ready:
                record['score'] = str(contribution(c['year'], int(rank), total, kind))
                record['rankCoefficient'] = str(rank_coefficient(int(rank), total))
            records[rid] = record
            by_lookup[kind, c['year'], name, province].append(record)
    return records, by_lookup, students


def choose_match(result, candidates):
    if len(candidates) <= 1:
        return candidates[0] if candidates else None
    score = number(result['score'])
    if score:
        same_score = [r for r in candidates if number(r['examScore']) == score]
        if same_score:
            candidates = same_score
    if len(candidates) > 1:
        same_school = [r for r in candidates if normalized(r['school']) == normalized(result['school'])]
        if same_school:
            candidates = same_school
    if len(candidates) > 1 and result['grade']:
        candidates = [r for r in candidates if r['grade'] == result['grade']]
    return candidates[0] if len(candidates) == 1 else None


def contest_order(record):
    """Seasonal ordering within a calendar year; parallel event categories share a slot."""
    return record['year'], CONTEST_ORDER[record['contestType']]


def resolve_attributions(records, guidance, exceptions):
    """Apply explicit lists, then carry the latest complete list forward within its school year."""
    groups = defaultdict(list)
    for record in records.values():
        if record['eligible']:
            groups[record['studentId'], record.get('schoolYear'), record['province']].append(record)
    periods, pending = [], []
    for (sid, school_year, province), group in groups.items():
        latest_teachers, latest_evidence = [], []
        has_evidence = any(r['directCoaches'] or r['incompleteEvidence'] or r['id'] in exceptions for r in group)
        can_inherit = isinstance(school_year, int) and sid.startswith('oier-')
        period_id = 'period-' + hashlib.sha256(f'{sid}/chronological/{school_year}/{province}'.encode()).hexdigest()[:16]
        anchors, assigned_coaches = [], set()
        anchor_conflict = False
        for _, batch_rows in groupby(sorted(group, key=contest_order), key=contest_order):
            # Resolve the entire simultaneous event before updating the list for later events.
            candidate_sets, candidate_ids = set(), []
            incomplete = False
            for record in batch_rows:
                correction = exceptions.get(record['id'])
                ranges = [p for p in guidance if p['studentId'] == sid and p['stage'] == record['stage'] and p['province'] == province
                          and isinstance(record.get('schoolYear'), int) and p['fromSchoolYear'] <= record['schoolYear'] <= p['toSchoolYear']]
                if len({tuple(sorted(p['coachIds'])) for p in ranges}) > 1:
                    raise ValueError(f'Conflicting guidance ranges for {record["id"]}')
                record['attributions'] = []
                if correction:
                    teachers, kind, evidence, note = correction['coachIds'], 'manual', correction['sources'], correction['reason']
                elif record['directCoaches']:
                    teachers, kind, evidence, note = record['directCoaches'], 'direct', record['sourceIds'], '比赛名单列明'
                elif ranges:
                    teachers, kind, evidence, note = ranges[0]['coachIds'], 'manual', ranges[0]['sources'], ranges[0]['reason']
                elif can_inherit and latest_teachers and not record['incompleteEvidence']:
                    teachers, kind, evidence, note = latest_teachers, 'inferred', latest_evidence, '沿用同一选手、学年和省份内最近一场已填写的教师名单'
                else:
                    teachers, kind, evidence, note = [], 'inferred', [], ''
                    if has_evidence:
                        reason = 'no-earlier-complete-list' if can_inherit else 'identity-or-school-year-review'
                        pending.append({'resultId': record['id'], 'studentId': sid, 'reason': reason})
                record['attributions'] = [{'coachId': cid, 'type': kind, 'evidence': list(evidence), 'note': note,
                                           'periodId': period_id, 'ruleVersion': ATTRIBUTION_VERSION}
                                          for cid in sorted(set(teachers))]
                assigned_coaches.update(teachers)
                if correction:
                    # Empty per-result corrections revoke that result only.
                    if correction['coachIds']:
                        candidate_sets.add(tuple(sorted(set(correction['coachIds']))))
                        candidate_ids.append(record['id'])
                elif record['directCoaches'] or record['incompleteEvidence']:
                    candidate_sets.update(tuple(sorted(set(names))) for names in record['teacherSets'] if names)
                    incomplete |= record['incompleteEvidence']
                    if record['directCoaches']:
                        candidate_ids.append(record['id'])
            if candidate_sets or incomplete:
                anchors.extend(candidate_ids)
                if len(candidate_sets) == 1 and not incomplete:
                    latest_teachers = list(next(iter(candidate_sets)))
                    latest_evidence = sorted(candidate_ids)
                else:
                    latest_teachers, latest_evidence = [], []
                    anchor_conflict = True
        if has_evidence:
            known_stages = {record['stage'] for record in group if record['stage'] != 'unknown'}
            stage = next(iter(known_stages)) if len(known_stages) == 1 else 'unknown'
            periods.append({'id': period_id, 'studentId': sid, 'schoolYear': school_year, 'stage': stage, 'province': province,
                            'coachIds': sorted(assigned_coaches), 'status': 'review' if anchor_conflict else 'chronological',
                            'evidenceResultIds': sorted(anchors)})
    return periods, pending


def build_snapshots(coach_results, as_of_year, id_field='coachId'):
    all_years = [r['year'] for results in coach_results.values() for r in results if r['score'] is not None]
    snapshots = {}
    if not all_years:
        return snapshots
    for year in range(min(all_years), as_of_year + 1):
        scores = {}
        for cid, results in coach_results.items():
            included = [r for r in results if r['year'] <= year and r['score'] is not None]
            if included:
                scores[cid] = sum((Decimal(r['score']) for r in included), Decimal(0))
        ranks = competition_ranks(scores)
        snapshots[year] = {'year': year, 'population': len(scores), 'entries': [
            {id_field: cid, 'rank': rank, 'score': str(scores[cid])} for cid, rank in ranks.items()]}
    return snapshots


def validate_overrides(overrides, records, students, coaches, origins):
    for item in overrides['identities']:
        if item['resultId'] not in origins or 'oier-' + str(item['uid']) not in students:
            raise ValueError('Identity override references an unknown result or UID')
        if not item.get('reason') or not valid_sources(item.get('sources')):
            raise ValueError('Every identity correction needs evidence and a reason')
    exceptions = {}
    for item in overrides['results']:
        rid = origins.get(item['resultId'], item['resultId'])
        if rid not in records or rid in exceptions:
            raise ValueError(f'Unknown or duplicate result override: {rid}')
        exceptions[rid] = item
    for item in [*exceptions.values(), *overrides['guidance']]:
        if not item.get('reason') or not valid_sources(item.get('sources')) or any(cid not in coaches for cid in item['coachIds']):
            raise ValueError('Attribution correction needs valid coaches, evidence and a reason')
    for item in overrides['guidance']:
        if item['studentId'] not in students or item['stage'] not in ['primary', 'junior', 'senior'] or item['province'] not in PROVINCES or item['fromSchoolYear'] > item['toSchoolYear']:
            raise ValueError('Invalid guidance period')
    return exceptions


def valid_sources(urls):
    return isinstance(urls, list) and bool(urls) and all(isinstance(url, str) and urlsplit(url).scheme in ['https', 'http'] and bool(urlsplit(url).netloc) for url in urls)


def validate_corrections(overrides):
    expected = {'schemaVersion', 'identities', 'guidance', 'results', 'additionalResults', 'sources'}
    if set(overrides) != expected or overrides['schemaVersion'] != 1:
        raise ValueError('Unsupported corrections schema or unknown field')
    allowed = {
        'identities': {'resultId', 'uid', 'sources', 'reason'},
        'guidance': {'studentId', 'stage', 'province', 'fromSchoolYear', 'toSchoolYear', 'coachIds', 'sources', 'reason'},
        'results': {'resultId', 'coachIds', 'sources', 'reason', 'eligible', 'grade', 'schoolYear'},
        'sources': {'id', 'url', 'type'},
    }
    for category, fields in allowed.items():
        if not isinstance(overrides[category], list):
            raise ValueError(f'{category} must be an array')
        for item in overrides[category]:
            required = fields - {'eligible', 'grade', 'schoolYear'} if category == 'results' else fields
            if set(item) - fields or required - set(item):
                raise ValueError(f'Invalid fields in {category}: {item}')
    source_ids = [source['id'] for source in overrides['sources']]
    if len(source_ids) != len(set(source_ids)) or any(not valid_sources([source['url']]) for source in overrides['sources']):
        raise ValueError('Curated sources require unique IDs and HTTP(S) URLs')
    result_ids = [row['result_id'] for row in overrides['additionalResults']]
    if len(result_ids) != len(set(result_ids)):
        raise ValueError('Duplicate additional result IDs')
    for row in overrides['additionalResults']:
        if not row.get('source_ids') or not row.get('coach_evidence') and row.get('coach_names'):
            raise ValueError('Additional results need source IDs and original coach evidence')
    for item in overrides['results']:
        if 'eligible' in item and not isinstance(item['eligible'], bool):
            raise ValueError('eligible must be a boolean')
        if 'grade' in item and stage_of(item['grade']) == 'unknown':
            raise ValueError('A grade correction must identify an educational stage')
        if 'schoolYear' in item and not isinstance(item['schoolYear'], int):
            raise ValueError('schoolYear must be an integer')


def build(update_registry=False):
    manifest = json.loads((BASE / 'manifest.json').read_text(encoding='utf-8'))
    records, lookup, students = load_upstream(manifest)
    cleaned = [json.loads(line) for line in read_baseline('results.jsonl', manifest).splitlines()]
    overrides = json.loads((CURATED / 'corrections.json').read_text(encoding='utf-8'))
    validate_corrections(overrides)
    identities = {item['resultId']: item for item in overrides['identities']}
    if len(identities) != len(overrides['identities']):
        raise ValueError('Duplicate identity overrides')
    registry_path = CURATED / 'coaches.json'
    registry = json.loads(registry_path.read_text(encoding='utf-8')) if registry_path.exists() else []
    surnames = json.loads(read_baseline('surnames.json', manifest))
    name_exceptions = json.loads(read_baseline('name_exceptions.json', manifest))
    pypinyin.load_single_dict({ord(k): v for k, v in name_exceptions.items()})
    coach_keys, coaches = {}, {}
    for coach in registry:
        if not re.fullmatch(r'coach-[a-f0-9]{16}', coach['id']) or not coach['name'] or not re.fullmatch(r'[a-z]+', coach['initials']):
            raise ValueError('Coach registry requires a stable ID, name and lowercase pinyin initials')
        if coach['id'] in coaches:
            raise ValueError('Duplicate coach ID')
        coaches[coach['id']] = coach
        for key in coach['keys']:
            normalized_key = (normalized(key[0]), normalized_province(key[1]))
            if normalized_key in coach_keys and coach_keys[normalized_key] != coach['id']:
                raise ValueError('Ambiguous coach registry key')
            coach_keys[normalized_key] = coach['id']
    origins, issues = {}, []
    for result in cleaned + overrides['additionalResults']:
        result['province'] = normalized_province(result['province'])
        kind = contest_kind(result)
        if kind not in SUPPORTED:
            continue
        key = kind, result['year'], result['student'], result['province']
        candidates = lookup.get(key, [])
        identity = identities.get(result['result_id'])
        if identity:
            candidates = [r for r in records.values() if r['studentId'] == 'oier-' + str(identity['uid']) and r['contestType'] == kind and r['year'] == result['year']]
        match = choose_match(result, candidates)
        if match is None:
            rid = 'external-' + result['result_id']
            sid = 'oier-' + str(identity['uid']) if identity else 'pending-' + result['result_id']
            students.setdefault(sid, {'id': sid, 'uid': None, 'name': result['student'], 'initials': '', 'identityStatus': 'review'})
            match = {'id': rid, 'studentId': sid, 'contest': f'{result["event"]}{result["year"]} {result["group"]}'.strip(),
                     'event': result['event'], 'contestType': kind, 'year': result['year'],
                     'schoolYear': result['year'] - (result['event'] != 'NOIP'), 'province': result['province'],
                     'school': result['school'], 'grade': result['grade'], 'stage': stage_of(result['grade']), 'award': result['award'],
                     'examScore': result['score'], 'rank': None, 'population': None, 'rankBasis': 'pending', 'populationBasis': 'pending',
                     'eligible': True, 'core': kind in WEIGHTS, 'score': None, 'sourceIds': [], 'evidence': [], 'originIds': [],
                     'teacherSets': [], 'directCoaches': [], 'incompleteEvidence': False, 'scoringVersion': SCORING_VERSION}
            records[rid] = match
            if result['coach_names']:
                issues.append({'resultId': rid, 'reason': 'upstream-match-pending'})
        origins[result['result_id']] = match['id']
        match['originIds'].append(result['result_id'])
        match['sourceIds'] = sorted(set(match['sourceIds'] + result['source_ids']))
        match['evidence'].extend(result['coach_evidence'])
        match['incompleteEvidence'] |= result['coach_status'] == 'review'
        if match['stage'] == 'unknown' and stage_of(result['grade']) != 'unknown':
            match['grade'], match['stage'] = result['grade'], stage_of(result['grade'])
        elif stage_of(result['grade']) not in ['unknown', match['stage']]:
            match['incompleteEvidence'] = True
            issues.append({'resultId': match['id'], 'reason': 'conflicting-grade-stage'})
        if result['eligibility'] != 'listed':
            match['eligible'] = False
            match['score'] = None
        teacher_ids = []
        for name in result['coach_names']:
            coach_key = (normalized(name), result['province'])
            if coach_key not in coach_keys:
                if not update_registry:
                    raise ValueError(f'Unregistered coach {coach_key}. Run with --update-registry and review the registry diff.')
                cid = 'coach-' + uuid.uuid5(uuid.NAMESPACE_URL, '/'.join(coach_key)).hex[:16]
                coach = {'id': cid, 'name': name, 'province': result['province'], 'initials': name_initials(name, surnames), 'keys': [list(coach_key)]}
                coaches[cid], coach_keys[coach_key] = coach, cid
            teacher_ids.append(coach_keys[coach_key])
        match['directCoaches'] = sorted(set(match['directCoaches'] + teacher_ids))
        for evidence in result['coach_evidence']:
            evidence_ids = [coach_keys[normalized(name), result['province']] for name in evidence['names'] if (normalized(name), result['province']) in coach_keys]
            if evidence_ids:
                match['teacherSets'].append(evidence_ids)
            match['incompleteEvidence'] |= bool(evidence.get('unresolved'))
        if teacher_ids and not result['coach_evidence']:
            match['teacherSets'].append(teacher_ids)
    exceptions = validate_overrides(overrides, records, students, coaches, origins)
    for rid, correction in exceptions.items():
        if 'grade' in correction:
            records[rid]['originalGrade'] = records[rid]['grade']
            records[rid]['grade'], records[rid]['stage'] = correction['grade'], stage_of(correction['grade'])
        if 'schoolYear' in correction:
            records[rid]['schoolYear'] = correction['schoolYear']
        if 'eligible' in correction:
            records[rid]['eligible'] = correction['eligible']
            if not correction['eligible']:
                records[rid]['score'] = None
            elif records[rid]['core'] and records[rid]['rankBasis'] != 'pending':
                r = records[rid]
                r['score'] = str(contribution(r['year'], r['rank'], r['population'], r['contestType']))
    periods, pending = resolve_attributions(records, overrides['guidance'], exceptions)
    issues.extend(pending)
    if update_registry:
        registry_path.write_text(json.dumps(sorted(coaches.values(), key=lambda c: c['id']), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    coach_results = defaultdict(list)
    for record in records.values():
        for attribution in record.get('attributions', []):
            coach_results[attribution['coachId']].append(record)
    # Preserve searchable honor-only profiles and explicitly curated profiles.
    for cid in coaches:
        coach_results.setdefault(cid, [])
    as_of_year = int(manifest['asOf'][:4])
    if any(r['year'] > as_of_year for r in records.values()):
        raise ValueError('Snapshot contains results after its as-of year')
    snapshots = build_snapshots(coach_results, as_of_year)
    histories = defaultdict(list)
    for year, snapshot in snapshots.items():
        for entry in snapshot['entries']:
            histories[entry['coachId']].append({**entry, 'year': year, 'population': snapshot['population']})
    student_results = defaultdict(list)
    for record in records.values():
        if record['eligible']:
            student_results[record['studentId']].append(record)
    ranked_student_results = {sid: results for sid, results in student_results.items()
                              if students[sid]['identityStatus'] == 'confirmed'}
    student_snapshots = build_snapshots(ranked_student_results, as_of_year, 'studentId')
    student_histories = defaultdict(list)
    for year, snapshot in student_snapshots.items():
        for entry in snapshot['entries']:
            student_histories[entry['studentId']].append({**entry, 'year': year, 'population': snapshot['population']})
    sources = {s['id']: s for s in json.loads(read_baseline('sources.json', manifest))}
    sources['oierdb'] = {'id': 'oierdb', 'url': f'https://github.com/OIerDb-ng/OIerDb/tree/{manifest["scoringCommit"]}', 'type': 'oierdb'}
    for source in overrides['sources']:
        if source['id'] in sources:
            raise ValueError('Curated source ID conflicts with baseline')
        sources[source['id']] = source
    for row in overrides['additionalResults']:
        if any(source_id not in sources for source_id in row['source_ids']):
            raise ValueError('Additional result references unknown evidence source')
    periods_by_student = defaultdict(list)
    for period in periods:
        periods_by_student[period['studentId']].append(period)
    input_hash = hashlib.sha256()
    for path in [BASE / 'manifest.json', registry_path, CURATED / 'corrections.json', Path(__file__), ROOT / 'scripts/scoring.py']:
        input_hash.update(path.read_bytes())
    version = input_hash.hexdigest()[:16]
    public = ROOT / 'public/data'
    public.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.site-build-', dir=ROOT / 'data'))

    def write(path, value):
        destination = staging / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    index = []
    coach_previews = {}
    student_previews = {}
    for cid, results in coach_results.items():
        coach = coaches[cid]
        history = histories[cid]
        peak = min(history, key=lambda row: (row['rank'], row['year'])) if history else None
        student_ids = {r['studentId'] for r in results}
        row = {key: coach[key] for key in ['id', 'name', 'province', 'initials']}
        row.update({'currentRank': history[-1]['rank'] if history else None,
                    'peakRank': peak['rank'] if peak else None, 'peakYear': peak['year'] if peak else None,
                    'peakPopulation': peak['population'] if peak else None,
                    'score': history[-1]['score'] if history else None, 'studentCount': len(student_ids),
                    'resultCount': len(results), 'pendingCount': sum(r['core'] and r['score'] is None for r in results)})
        index.append(row)
        contributions = defaultdict(list)
        for result in results:
            contributions[result['studentId']].append(result)
        student_totals = {sid: sum((Decimal(r['score']) for r in rows if r['score'] is not None), Decimal(0))
                          if any(r['score'] is not None for r in rows) else None
                          for sid, rows in contributions.items()}
        leaders = sorted(student_totals, key=lambda sid: (student_totals[sid] is None, -(student_totals[sid] or 0), sid))[:3]
        coach_previews[cid] = [[sid, students[sid]['name'], str(student_totals[sid].quantize(Decimal('.01'))) if student_totals[sid] is not None else None] for sid in leaders]
        display_results = []
        for record in results:
            attribution = next(a for a in record['attributions'] if a['coachId'] == cid)
            display_results.append({**{k: v for k, v in record.items() if k not in ['teacherSets', 'directCoaches', 'incompleteEvidence', 'attributions']}, 'attribution': attribution})
        result_ids = {r['id'] for r in results}
        relevant_periods = [p for sid in student_ids for p in periods_by_student[sid] if cid in p['coachIds'] or result_ids.intersection(p['evidenceResultIds'])]
        source_ids = {source for r in results for source in r['sourceIds']}
        # Inferred attribution carries the original teacher evidence, even when its anchor
        # is a different contest than the expanded row.
        anchor_records = {anchor: records[anchor] for r in results if (a := next(a for a in r['attributions'] if a['coachId'] == cid))['type'] == 'inferred' for anchor in a['evidence']}
        source_ids.update(s for r in anchor_records.values() for s in r['sourceIds'])
        detail = {**row, 'history': history, 'students': [students[sid] for sid in sorted(student_ids)],
                                    'results': sorted(display_results, key=lambda r: (-r['year'], r['id'])),
                                    'guidancePeriods': relevant_periods, 'manualGuidance': [p for p in overrides['guidance'] if cid in p['coachIds']],
                                    'sources': [sources[s] for s in sorted(source_ids) if s in sources],
                                    'anchors': [{'id': r['id'], 'contest': r['contest'], 'sourceIds': r['sourceIds'], 'evidence': r['evidence'], 'correction': exceptions.get(r['id'])} for r in anchor_records.values()],
                                    'updatedAt': manifest['asOf'], 'version': version}
        write(f'coaches/{cid}.json', detail)
        for old_id in coach.get('redirectIds', []):
            if old_id in coaches:
                raise ValueError('Redirect ID conflicts with active coach')
            write(f'coaches/{old_id}.json', detail)
    index.sort(key=lambda c: (c['currentRank'] is None, c['currentRank'] or 0, c['id']))
    write('coaches.json', index)
    for year, snapshot in snapshots.items():
        write(f'rankings/{year}.json', snapshot)
    student_index = []
    student_result_fields = ['id', 'studentId', 'contest', 'contestType', 'event', 'year', 'schoolYear',
                             'province', 'school', 'grade', 'stage', 'award', 'examScore', 'rank',
                             'population', 'core', 'score']
    for sid, results in student_results.items():
        student = students[sid]
        history = student_histories[sid]
        peak = min(history, key=lambda row: (row['rank'], row['year'])) if history else None
        coach_scores = defaultdict(Decimal)
        for result in results:
            for attribution in result.get('attributions', []):
                coach_scores[attribution['coachId']] += Decimal(result['score'] or '0')
        related_coaches = [{key: coaches[cid][key] for key in ['id', 'name', 'province']}
                           for cid in sorted(coach_scores, key=lambda cid: (-coach_scores[cid], cid))]
        summary = {**student, 'initials': student['initials'] or name_initials(student['name'], surnames),
                   'provinces': sorted({province for r in results
                                        if (province := {'内蒙': '内蒙古', '长沙': '湖南'}.get(r['province'], r['province'])) in PROVINCES}),
                   'currentRank': history[-1]['rank'] if history else None,
                   'score': history[-1]['score'] if history else None,
                   'peakRank': peak['rank'] if peak else None, 'peakYear': peak['year'] if peak else None,
                   'peakPopulation': peak['population'] if peak else None,
                   'coachCount': len(related_coaches), 'coaches': related_coaches[:2], 'resultCount': len(results)}
        student_index.append(summary)
        guidance_groups = defaultdict(set)
        for result in results:
            guidance_groups[result['schoolYear'], result['province']].update(a['coachId'] for a in result.get('attributions', []))
        student_previews[sid] = [[year, province, sorted(ids)] for (year, province), ids in sorted(guidance_groups.items(), key=lambda item: (-item[0][0], item[0][1]))]
        display_results = [{**{key: result[key] for key in student_result_fields},
                            'coachIds': sorted({a['coachId'] for a in result.get('attributions', [])})}
                           for result in sorted(results, key=lambda r: (-r['year'], r['id']))]
        write(f'students/{quote(sid, safe="")}.json', {**summary, 'coaches': related_coaches,
              'history': history, 'results': display_results, 'guidancePeriods': periods_by_student[sid],
              'manualGuidance': [period for period in overrides['guidance'] if period['studentId'] == sid]})
    student_index.sort(key=lambda s: (s['currentRank'] is None, s['currentRank'] or 0, s['id']))
    write('students.json', student_index)
    # Compact display directories keep exact ranking order while sharing coach references.
    # Full-precision indices and evidence remain available in the existing JSON exports.
    references = [[cid, coach['name'], coach['province']] for cid, coach in sorted(coaches.items())]
    reference_indices = {row[0]: index for index, row in enumerate(references)}
    directory_bytes = {}
    for entity, people, previews in [('coaches', index, coach_previews), ('students', student_index, student_previews)]:
        fields = list(people[0]) + ['preview'] if people else []
        packed_rows = []
        for person in people:
            display = dict(person)
            display['score'] = str(Decimal(person['score']).quantize(Decimal('.01'))) if person['score'] is not None else None
            if entity == 'students':
                display['coaches'] = [reference_indices[coach['id']] for coach in person['coaches']]
                display['preview'] = [[year, province, [reference_indices[cid] for cid in ids]] for year, province, ids in previews[person['id']]]
            else:
                display['preview'] = previews[person['id']]
            packed_rows.append([display[field] for field in fields])
        filename = f'{entity}-directory.json'
        payload = {'format': 'person-directory-v1', 'entity': entity, 'fields': fields, 'rows': packed_rows}
        if entity == 'students':
            payload['coachReferences'] = references
        write(filename, payload)
        directory_bytes[filename] = (staging / filename).stat().st_size
    for year, snapshot in student_snapshots.items():
        write(f'student-rankings/{year}.json', snapshot)
    write('sources.json', list(sources.values()))
    write('review.json', issues)
    coverage = {}
    for record in records.values():
        if not record['core'] or not record['eligible']:
            continue
        scope = 'upstream' if record['id'].startswith('oier-') else 'unmatched-evidence'
        key = record['year'], record['contestType'], record['stage'], scope
        counts = coverage.setdefault(key, {'records': 0, 'withExplicitTeachers': 0,
                                          'attributed': 0, 'scored': 0, 'awaitingAttribution': 0})
        counts['records'] += 1
        counts['withExplicitTeachers'] += bool(record['directCoaches'])
        attributed = bool(record.get('attributions'))
        counts['attributed'] += attributed
        counts['scored'] += attributed and record['score'] is not None
        counts['awaitingAttribution'] += not attributed
    write('coverage.json', {
        'version': version,
        'countingUnit': 'unique-exam-record',
        'rows': [{**dict(zip(['year', 'contestType', 'stage', 'scope'], key)), **value}
                 for key, value in sorted(coverage.items())],
    })
    site_manifest = {'schemaVersion': 1, 'version': version, 'attributionVersion': ATTRIBUTION_VERSION, 'asOf': manifest['asOf'], 'scoringVersion': SCORING_VERSION,
                     'scoringCommit': manifest['scoringCommit'], 'coachCount': len(index),
                     'rankedCount': len(snapshots[as_of_year]['entries']) if snapshots else 0,
                     'studentCount': len({r['studentId'] for rows in coach_results.values() for r in rows}),
                     'attributedResultCount': len({r['id'] for rows in coach_results.values() for r in rows}),
                     'reviewCount': len(issues), 'years': list(snapshots),
                     'studentIndex': 'students.json', 'studentDirectory': 'students-directory.json', 'coachDirectory': 'coaches-directory.json',
                     'directoryBytes': directory_bytes, 'studentYears': list(student_snapshots),
                     'indexedStudentCount': len(student_index),
                     'rankedStudentCount': len(student_snapshots[as_of_year]['entries']) if student_snapshots else 0,
                     'studentProvinces': sorted({province for student in student_index for province in student['provinces']}),
                     'provinces': sorted({c['province'] for c in index if c['province']}),
                     'dataPath': f'/data/{version}/', 'index': 'coaches.json'}
    write('manifest.json', site_manifest)
    destination = public / version
    if destination.exists():
        # Identical input versions are immutable. A retry need not rewrite their files.
        assert staging.resolve().parent == (ROOT / 'data').resolve() and staging.name.startswith('.site-build-')
        shutil.rmtree(staging)
    else:
        for attempt in range(10):
            try:
                os.replace(staging, destination)
                break
            except OSError:
                if (destination / 'manifest.json').exists():
                    assert staging.resolve().parent == (ROOT / 'data').resolve() and staging.name.startswith('.site-build-')
                    shutil.rmtree(staging)
                    break
                if attempt == 9:
                    raise
                time.sleep(.3)
    temp_manifest = public / f'manifest-{uuid.uuid4().hex}.tmp'
    temp_manifest.write_text(json.dumps(site_manifest, ensure_ascii=False), encoding='utf-8')
    atomic_replace(temp_manifest, public / 'manifest.json')
    print(json.dumps({k: site_manifest[k] for k in ['version', 'coachCount', 'rankedCount', 'studentCount', 'indexedStudentCount', 'rankedStudentCount', 'attributedResultCount', 'reviewCount']}, ensure_ascii=False))
    return site_manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--update-registry', action='store_true')
    build(parser.parse_args().update_registry)
