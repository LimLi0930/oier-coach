"""Regression tests for the accepted scoring, identity and attribution contract."""
import json
import gzip
import hashlib
import sys
import unittest
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from scoring import RANK_COEFFICIENTS, WEIGHTS, competition_ranks, contribution, rank_coefficient
from build_site_data import ATTRIBUTION_VERSION, PROVINCES, SUPPORTED, build_snapshots, choose_match, contest_kind, contest_order, resolve_attributions, stage_of, validate_corrections


def record(rid, year=2024, stage='senior', teachers=(), **extra):
    return {'id': rid, 'studentId': 'oier-1', 'stage': stage, 'province': '重庆', 'year': year,
            'schoolYear': year, 'contestType': 'NOIP', 'eligible': True, 'directCoaches': list(teachers),
            'teacherSets': [list(teachers)] if teachers else [], 'incompleteEvidence': False,
            'sourceIds': ['source-1'], 'score': '100', **extra}


class ScoringTests(unittest.TestCase):
    def test_exact_401_bins(self):
        self.assertEqual(len(RANK_COEFFICIENTS), 401)
        self.assertEqual(RANK_COEFFICIENTS, sorted(RANK_COEFFICIENTS, reverse=True))
        self.assertEqual(RANK_COEFFICIENTS[60:62], [Decimal(40), Decimal('35.85')])
        self.assertEqual(RANK_COEFFICIENTS[249:251], [Decimal('7.65'), Decimal('7.50')])
        for index in range(401):
            expected = Decimal(100 - index) if index <= 60 else Decimal('.15') * (300 - index) if index <= 249 else Decimal('.05') * (400 - index)
            self.assertEqual(RANK_COEFFICIENTS[index], expected)

    def test_noip_2025_acceptance(self):
        self.assertEqual(rank_coefficient(1, 7548), Decimal(100))
        self.assertEqual(rank_coefficient(50, 7548), Decimal(98))
        self.assertGreater(contribution(2025, 1, 7548, 'NOIP'), contribution(2025, 50, 7548, 'NOIP'))

    def test_ioi_noi_custom_weights(self):
        self.assertEqual(WEIGHTS['IOI'], Decimal('1'))
        self.assertEqual(WEIGHTS['NOI'], Decimal('.7'))
        self.assertEqual(contribution(2000, 1, 1000, 'IOI'), Decimal('100'))
        self.assertEqual(contribution(2000, 1, 1000, 'NOI'), Decimal('70'))
        self.assertEqual(WEIGHTS['NOID类'], WEIGHTS['NOI'])
        self.assertEqual(contribution(2026, 1, 177, 'NOID类'), contribution(2026, 1, 177, 'NOI'))
        self.assertNotIn('NOIST', SUPPORTED)

    def test_clamping_zero_and_precision(self):
        self.assertEqual(rank_coefficient(9000, 7548), Decimal(0))
        self.assertEqual(rank_coefficient(-1, 7548), Decimal(100))
        with self.assertRaises(ValueError):
            rank_coefficient(1, 0)
        ranks = competition_ranks({'a': Decimal('1.0000000000000000000001'), 'b': Decimal(1)})
        self.assertEqual(ranks, {'a': 1, 'b': 2})

    def test_ties(self):
        self.assertEqual(competition_ranks({'b': Decimal(3), 'a': Decimal(3), 'c': Decimal(0)}), {'a': 1, 'b': 1, 'c': 3})

    def test_history_excludes_future(self):
        snapshots = build_snapshots({'a': [record('1', 2024), record('2', 2025, score='300')], 'b': [record('3', 2025, score='0')]}, 2026)
        self.assertEqual(snapshots[2024]['entries'], [{'coachId': 'a', 'rank': 1, 'score': '100'}])
        self.assertEqual(snapshots[2025]['population'], 2)
        self.assertEqual(snapshots[2025]['entries'][0]['score'], '400')

    def test_student_snapshots_and_pending_scores(self):
        snapshots = build_snapshots({'a': [record('1', 2024)], 'b': [record('2', 2024)],
                                     'c': [record('3', 2025, score='0')],
                                     'pending': [record('4', score=None)]}, 2026, 'studentId')
        self.assertEqual([r['rank'] for r in snapshots[2025]['entries']], [1, 1, 3])
        self.assertEqual(snapshots[2024]['population'], 2)
        self.assertEqual(snapshots[2026]['entries'][2]['studentId'], 'c')


class AttributionTests(unittest.TestCase):
    def test_full_credit_dedup_and_school_years(self):
        rows = {'1': record('1', teachers=['a', 'a', 'b']), '2': record('2', 2025, schoolYear=2024, contestType='WC'), '3': record('3', stage='junior', schoolYear=2023), '4': record('4', province='四川')}
        resolve_attributions(rows, [], {})
        self.assertEqual([a['coachId'] for a in rows['1']['attributions']], ['a', 'b'])
        self.assertEqual([a['coachId'] for a in rows['2']['attributions']], ['a', 'b'])
        self.assertEqual(rows['2']['score'], '100')
        self.assertFalse(rows['3']['attributions'])
        self.assertFalse(rows['4']['attributions'])

    def test_yearly_teacher_changes_and_cross_calendar_year(self):
        rows = {
            'noip2023': record('noip2023', 2023, teachers=['a', 'b']),
            'noi2024': record('noi2024', 2024, schoolYear=2023, contestType='NOI', teachers=['a', 'b']),
            'apio2024': record('apio2024', 2024, schoolYear=2023, contestType='APIO'),
            'noip2024': record('noip2024', 2024, schoolYear=2024, teachers=['a', 'b', 'c']),
            'wc2025': record('wc2025', 2025, schoolYear=2024, contestType='WC'),
            'noip2025': record('noip2025', 2025, schoolYear=2025, teachers=['a', 'b', 'c']),
            'ioi2026': record('ioi2026', 2026, schoolYear=2025, contestType='IOI'),
            'nextyear': record('nextyear', 2027, schoolYear=2026),
        }
        periods, pending = resolve_attributions(rows, [], {})
        self.assertEqual([a['coachId'] for a in rows['apio2024']['attributions']], ['a', 'b'])
        for rid in ['wc2025', 'ioi2026']:
            self.assertEqual([a['coachId'] for a in rows[rid]['attributions']], ['a', 'b', 'c'])
            self.assertEqual(rows[rid]['attributions'][0]['ruleVersion'], ATTRIBUTION_VERSION)
        self.assertFalse(rows['nextyear']['attributions'])
        self.assertEqual({p['schoolYear'] for p in periods}, {2023, 2024, 2025})
        self.assertEqual(pending, [])

    def test_same_year_known_identity_with_unknown_grade(self):
        rows = {'1': record('1', teachers=['a']), '2': record('2', 2025, stage='unknown', schoolYear=2024, contestType='WC')}
        resolve_attributions(rows, [], {})
        self.assertEqual(rows['2']['attributions'][0]['coachId'], 'a')

    def test_changed_teacher_sets_pending(self):
        rows = {'1': record('1', teachers=['a']), '2': record('2', teachers=['b']), '3': record('3', 2025, schoolYear=2024, contestType='WC')}
        periods, pending = resolve_attributions(rows, [], {})
        self.assertEqual(periods[0]['status'], 'review')
        self.assertFalse(rows['3']['attributions'])
        self.assertEqual(pending[0]['resultId'], '3')
        self.assertEqual(rows['1']['attributions'][0]['coachId'], 'a')

    def test_latest_explicit_list_replaces_previous_without_backward_fill(self):
        rows = {
            'early': record('early', 2025, schoolYear=2024, contestType='WC'),
            'apio': record('apio', 2025, schoolYear=2024, contestType='APIO', teachers=['a']),
            'noi': record('noi', 2025, schoolYear=2024, contestType='NOI', teachers=['b', 'c']),
            'ioi': record('ioi', 2025, schoolYear=2024, contestType='IOI'),
            'next': record('next', 2025, schoolYear=2025),
        }
        resolve_attributions(rows, [], {})
        self.assertFalse(rows['early']['attributions'])
        self.assertEqual([a['coachId'] for a in rows['apio']['attributions']], ['a'])
        self.assertEqual([a['coachId'] for a in rows['ioi']['attributions']], ['b', 'c'])
        self.assertEqual(rows['ioi']['attributions'][0]['evidence'], ['noi'])
        self.assertFalse(rows['next']['attributions'])
        reversed_rows = dict(reversed(list(rows.items())))
        resolve_attributions(reversed_rows, [], {})
        self.assertEqual(reversed_rows['ioi']['attributions'][0]['evidence'], ['noi'])

    def test_incomplete_recent_list_blocks_old_teacher_fallback(self):
        rows = {
            'noip': record('noip', teachers=['a']),
            'noi': record('noi', 2025, schoolYear=2024, contestType='NOI', teachers=['b'], incompleteEvidence=True),
            'ioi': record('ioi', 2025, schoolYear=2024, contestType='IOI'),
        }
        resolve_attributions(rows, [], {})
        self.assertEqual(rows['noi']['attributions'][0]['coachId'], 'b')
        self.assertFalse(rows['ioi']['attributions'])

    def test_manual_record_updates_later_inheritance(self):
        rows = {'noi': record('noi', contestType='NOI', teachers=['a']), 'ioi': record('ioi', contestType='IOI')}
        resolve_attributions(rows, [], {'noi': {'coachIds': ['b'], 'sources': ['https://example.org'], 'reason': 'correction'}})
        self.assertEqual(rows['ioi']['attributions'][0]['coachId'], 'b')
        self.assertEqual(rows['ioi']['attributions'][0]['evidence'], ['noi'])

    def test_manual_period_and_exception(self):
        rows = {'1': record('1', teachers=['a']), '2': record('2', 2025), '3': record('3', 2026, teachers=['b'])}
        guidance = [{'studentId': 'oier-1', 'stage': 'senior', 'province': '重庆', 'fromSchoolYear': 2024, 'toSchoolYear': 2025, 'coachIds': ['a'], 'sources': ['https://example.org/evidence'], 'reason': '学年名单'}]
        resolve_attributions(rows, guidance, {})
        self.assertEqual(rows['2']['attributions'][0]['type'], 'manual')
        self.assertEqual(rows['3']['attributions'][0]['coachId'], 'b')
        resolve_attributions(rows, guidance, {'1': {'coachIds': ['c'], 'sources': ['https://example.org/evidence'], 'reason': '逐场更正'}})
        self.assertEqual(rows['1']['attributions'][0]['coachId'], 'c')

    def test_conflicting_periods_fail(self):
        period = {'studentId': 'oier-1', 'stage': 'senior', 'province': '重庆', 'fromSchoolYear': 2024, 'toSchoolYear': 2025, 'coachIds': ['a'], 'sources': ['url'], 'reason': 'test'}
        with self.assertRaises(ValueError):
            resolve_attributions({'1': record('1')}, [period, {**period, 'coachIds': ['b']}], {})

    def test_incomplete_unknown_disqualified_and_identity(self):
        for extra in [{'schoolYear': None}, {'studentId': 'pending-1'}, {'incompleteEvidence': True}]:
            rows = {'1': record('1', teachers=['a'], **extra), '2': record('2', 2025, contestType='WC', **{'schoolYear': 2024, **extra})}
            resolve_attributions(rows, [], {})
            self.assertFalse(rows['2']['attributions'])
        rows = {'1': record('1', teachers=['a'], eligible=False), '2': record('2')}
        resolve_attributions(rows, [], {})
        self.assertNotIn('attributions', rows['1'])
        self.assertFalse(rows['2']['attributions'])

    def test_every_supported_contest_has_a_sequence_slot(self):
        for kind in SUPPORTED:
            self.assertIsInstance(contest_order(record('1', contestType=kind))[1], int)
        self.assertLess(contest_order(record('noip', 2025)), contest_order(record('wc', 2026, contestType='WC')))
        self.assertLess(contest_order(record('noi', 2026, contestType='NOI')), contest_order(record('ioi', 2026, contestType='IOI')))

    def test_primary_and_unknown(self):
        self.assertEqual(stage_of('小六'), 'primary')
        self.assertEqual(stage_of(''), 'unknown')
        self.assertEqual(stage_of('小学/无'), 'unknown')
        self.assertEqual(stage_of('九年级'), 'junior')
        self.assertEqual(contest_kind({'event': 'APIO', 'variant': 'online'}), 'APIO-online')

    def test_ambiguous_match_not_collapsed(self):
        result = {'score': '', 'school': '同校', 'grade': '高一'}
        candidates = [{'id': 'a', 'examScore': '100', 'school': '同校', 'grade': '高一'}, {'id': 'b', 'examScore': '100', 'school': '同校', 'grade': '高一'}]
        self.assertIsNone(choose_match(result, candidates))

    def test_correction_schema_rejects_unknown_fields_and_missing_evidence(self):
        empty = {'schemaVersion': 1, 'identities': [], 'guidance': [], 'results': [], 'additionalResults': [], 'sources': []}
        validate_corrections(empty)
        with self.assertRaises(ValueError):
            validate_corrections({**empty, 'typo': []})
        with self.assertRaises(ValueError):
            validate_corrections({**empty, 'sources': [{'id': 'bad', 'url': 'javascript:alert(1)', 'type': 'school_report'}]})


class BuiltDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / 'public/data/manifest.json').read_text(encoding='utf-8'))
        cls.base = ROOT / 'public/data' / cls.manifest['version']
        cls.index = json.loads((cls.base / 'coaches.json').read_text(encoding='utf-8'))
        packed = json.loads((cls.base / cls.manifest['coachDirectory']).read_text(encoding='utf-8'))
        cls.directory = {row[0]: dict(zip(packed['fields'], row)) for row in packed['rows']}

    def detail(self, cid):
        return json.loads((self.base / 'coaches' / (cid + '.json')).read_text(encoding='utf-8'))

    def test_pinned_weights_and_complete_populations(self):
        baseline = ROOT / 'data/baseline'
        upstream_weights = json.loads(gzip.decompress((baseline / 'scoring.json.gz').read_bytes()))
        expected = {kind: Decimal(upstream_weights[kind]) for kind in WEIGHTS}
        expected.update(IOI=Decimal('1'), NOI=Decimal('.7'), NOID类=Decimal('.7'))
        self.assertEqual(WEIGHTS, expected)
        static = json.loads(gzip.decompress((baseline / 'static.json.gz').read_bytes()))
        raw_counts, canonical_counts = Counter(), Counter()
        for line in gzip.decompress((baseline / 'raw.txt.gz').read_bytes()).decode().splitlines():
            cells = line.split(',')
            if len(cells) == 9 and not line.startswith('#'):
                raw_counts[cells[0]] += 1
        for line in gzip.decompress((baseline / 'result.txt.gz').read_bytes()).decode().splitlines():
            for result in line.split(',', 8)[8].split('/'):
                contest = static['contests'][int(result.split(':')[0])]
                canonical_counts[contest['name']] += 1
        self.assertEqual(raw_counts, canonical_counts)

    def test_yin_jun_three_coaches_and_campuses(self):
        for name in ['黄新军', '刘雨俊', '党东']:
            matches = [c for c in self.index if c['name'] == name and c['province'] == '重庆']
            self.assertEqual(len(matches), 1)
            coach = self.detail(matches[0]['id'])
            student = next(s for s in coach['students'] if s['name'] == '殷骏')
            self.assertEqual(student['uid'], 86883)
            rows = [r for r in coach['results'] if r['studentId'] == student['id']]
            senior = [r for r in rows if r['stage'] == 'senior']
            junior = [r for r in rows if r['stage'] == 'junior']
            self.assertEqual(len(senior), 7)
            self.assertEqual(len(junior), 1)
            self.assertFalse(any(r['contest'] == 'APIO2023' for r in rows))
            self.assertTrue(all(r['score'] is not None for r in rows))
            self.assertEqual(sum(r['attribution']['type'] == 'inferred' for r in senior), 3)
            junior_anchor = next(r for r in junior if r['contestType'] == 'NOID类')
            self.assertEqual(junior_anchor['attribution']['type'], 'direct')
            self.assertTrue(all(junior_anchor['attribution']['periodId'] != r['attribution']['periodId'] for r in senior))
            if name == '黄新军':
                self.assertEqual(coach['initials'], 'hxj')
                self.assertGreater(len({r['school'] for r in coach['results']}), 1)

    def test_jiang_mingrui_junior_summer_and_stage_credit(self):
        contributions = []
        for name in ['陈俊先', '祝敏磊', '张柯']:
            coach = next(c for c in self.index if c['name'] == name and c['province'] == '四川')
            detail = self.detail(coach['id'])
            student = next(s for s in detail['students'] if s['name'] == '蒋明睿')
            self.assertEqual(student['uid'], 149374)
            rows = [r for r in detail['results'] if r['studentId'] == student['id']]
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(r['stage'] == 'junior' and r['core'] and r['score'] is not None for r in rows))
            self.assertEqual(sum(r['attribution']['type'] == 'direct' for r in rows), 2)
            self.assertEqual(sum(r['attribution']['type'] == 'inferred' for r in rows), 0)
            contributions.append({r['id']: r['score'] for r in rows})
        self.assertEqual(contributions[0], contributions[1])
        self.assertEqual(contributions[1], contributions[2])

    def test_all_summer_teacher_records_are_published(self):
        baseline = ROOT / 'data/baseline'
        rows = [json.loads(line) for line in gzip.decompress((baseline / 'results.jsonl.gz').read_bytes()).decode().splitlines()]
        corrections = json.loads((ROOT / 'data/curated/corrections.json').read_text(encoding='utf-8'))
        rows.extend(corrections['additionalResults'])
        named = {row['result_id'] for row in rows if row['event'] == 'NOI' and row['variant'] in ['invitational', 'summer'] and row['eligibility'] == 'listed' and row['coach_names']}
        withdrawn = {row['resultId'] for row in corrections['results'] if not row['coachIds'] or row.get('eligible') is False}
        published = set()
        year_2023 = set()
        for coach in self.index:
            for result in self.detail(coach['id'])['results']:
                if result['contestType'] != 'NOID类':
                    continue
                published.update(result['originIds'])
                self.assertTrue(result['core'])
                if result['year'] == 2023 and result['id'].startswith('oier-'):
                    self.assertIsNotNone(result['score'])
                    year_2023.add(result['id'])
        self.assertFalse(named - withdrawn - published, 'Some named summer results were dropped')
        self.assertEqual(len(year_2023), 128)
        coverage = json.loads((self.base / 'coverage.json').read_text(encoding='utf-8'))
        for row in coverage['rows']:
            self.assertEqual(row['attributed'] + row['awaitingAttribution'], row['records'])
            self.assertLessEqual(row['scored'], row['attributed'])
        summer_2026 = [row for row in coverage['rows'] if row['year'] == 2026 and row['contestType'] == 'NOID类' and row['scope'] == 'upstream']
        self.assertEqual(sum(row['scored'] for row in summer_2026), 177)

    def test_2023_image_transcription_evidence_and_matching(self):
        corrections = json.loads((ROOT / 'data/curated/corrections.json').read_text(encoding='utf-8'))
        rows = [row for row in corrections['additionalResults'] if row['result_id'].startswith('archive-noi2023-summer-')]
        self.assertEqual(len(rows), 128)
        hashes = {hashlib.sha256(path.read_bytes()).hexdigest() for path in (ROOT / 'data/baseline/evidence').glob('noi2023-*.png')}
        self.assertEqual(len(hashes), 5)
        for row in rows:
            evidence = row['coach_evidence'][0]
            self.assertIn(evidence['image_sha256'], hashes)
            self.assertEqual(set(row['coach_names']), set(evidence['names']))
            self.assertTrue(evidence['names'])

    def test_every_total_rank_and_history(self):
        scores, expected_histories = {}, defaultdict(dict)
        saw_list_rank, saw_honor, saw_zero = False, False, False
        for coach in self.index:
            data = self.detail(coach['id'])
            self.assertEqual(len({r['id'] for r in data['results']}), len(data['results']))
            self.assertEqual(len({r['studentId'] for r in data['results']}), coach['studentCount'])
            preview = self.directory[coach['id']]
            self.assertEqual(preview['currentRank'], coach['currentRank'])
            student_totals = {}
            for sid in {r['studentId'] for r in data['results']}:
                scored = [Decimal(r['score']) for r in data['results'] if r['studentId'] == sid and r['score'] is not None]
                student_totals[sid] = sum(scored, Decimal(0)) if scored else None
            leaders = sorted(student_totals, key=lambda sid: (student_totals[sid] is None, -(student_totals[sid] or 0), sid))[:3]
            self.assertEqual([row[0] for row in preview['preview']], leaders)
            for sid, name, score in preview['preview']:
                self.assertEqual(score, str(student_totals[sid].quantize(Decimal('.01'))) if student_totals[sid] is not None else None)
            contributions = [Decimal(r['score']) for r in data['results'] if r['score'] is not None]
            total = sum(contributions, Decimal(0)) if contributions else None
            self.assertEqual(str(total) if total is not None else None, coach['score'])
            if total is not None:
                scores[coach['id']] = total
            anchors = {row['id']: row for row in data['results']}
            for result in data['results']:
                saw_list_rank |= result['rankBasis'] == 'list'
                saw_honor |= result['core'] and result['score'] is None
                saw_zero |= result['score'] is not None and Decimal(result['score']) == 0
                self.assertTrue(result['eligible'])
                if result['attribution']['type'] == 'inferred':
                    self.assertEqual(result['attribution']['ruleVersion'], ATTRIBUTION_VERSION)
                    for anchor_id in result['attribution']['evidence']:
                        anchor = anchors[anchor_id]
                        self.assertLess(contest_order(anchor), contest_order(result))
                        self.assertEqual((anchor['studentId'], anchor['schoolYear'], anchor['province']),
                                         (result['studentId'], result['schoolYear'], result['province']))

                if not result['core']:
                    self.assertIsNone(result['score'])
                if result['score'] is not None:
                    self.assertEqual(Decimal(result['score']), contribution(result['year'], result['rank'], result['population'], result['contestType']))
                self.assertFalse(result['core'] and '线上' in result['contest'])
            for item in data['history']:
                historic = sum((Decimal(r['score']) for r in data['results'] if r['score'] is not None and r['year'] <= item['year']), Decimal(0))
                self.assertEqual(historic, Decimal(item['score']))
                expected_histories[item['year']][coach['id']] = historic
            if data['history']:
                peak = min(data['history'], key=lambda row: (row['rank'], row['year']))
                self.assertEqual((coach['peakRank'], coach['peakYear'], coach['peakPopulation']), (peak['rank'], peak['year'], peak['population']))
        self.assertTrue(saw_list_rank and saw_honor and saw_zero)
        ranks = competition_ranks(scores)
        for coach in self.index:
            self.assertEqual(coach['currentRank'], ranks.get(coach['id']))
        for year, totals in expected_histories.items():
            snapshot = json.loads((self.base / 'rankings' / f'{year}.json').read_text(encoding='utf-8'))
            self.assertEqual(snapshot['population'], len(totals))
            self.assertEqual({entry['coachId']: entry['rank'] for entry in snapshot['entries']}, competition_ranks(totals))


class StudentDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / 'public/data/manifest.json').read_text(encoding='utf-8'))
        cls.base = ROOT / 'public/data' / cls.manifest['version']
        cls.index = json.loads((cls.base / 'students.json').read_text(encoding='utf-8'))
        packed = json.loads((cls.base / cls.manifest['studentDirectory']).read_text(encoding='utf-8'))
        cls.directory = {row[0]: dict(zip(packed['fields'], row)) for row in packed['rows']}
        cls.references = packed['coachReferences']

    def detail(self, sid):
        return json.loads((self.base / 'students' / (quote(sid, safe='') + '.json')).read_text(encoding='utf-8'))

    def test_all_students_totals_history_ranks_and_bidirectional_links(self):
        snapshots = {year: json.loads((self.base / 'student-rankings' / f'{year}.json').read_text(encoding='utf-8'))
                     for year in self.manifest['studentYears']}
        snapshot_entries = {year: {entry['studentId']: entry for entry in snapshot['entries']}
                            for year, snapshot in snapshots.items()}
        coach_index = json.loads((self.base / 'coaches.json').read_text(encoding='utf-8'))
        coach_results = {}
        for coach in coach_index:
            detail = json.loads((self.base / 'coaches' / (coach['id'] + '.json')).read_text(encoding='utf-8'))
            for result in detail['results']:
                coach_results[coach['id'], result['id']] = (result['studentId'], result['score'])
        linked_results = set()
        saw_unassigned = saw_pending = saw_zero = saw_cross_province = False
        confirmed_scores = {}
        for student in self.index:
            detail = self.detail(student['id'])
            results = detail['results']
            self.assertEqual(student['resultCount'], len(results))
            preview = self.directory[student['id']]
            self.assertEqual(preview['currentRank'], student['currentRank'])
            self.assertEqual(preview['peakRank'], student['peakRank'])
            self.assertEqual(preview['provinces'], student['provinces'])
            self.assertEqual(preview['score'], str(Decimal(student['score']).quantize(Decimal('.01'))) if student['score'] is not None else None)
            self.assertEqual([self.references[index][0] for index in preview['coaches']], [coach['id'] for coach in student['coaches']])
            expected_guidance = defaultdict(set)
            for result in results:
                expected_guidance[result['schoolYear'], result['province']].update(result['coachIds'])
            actual_guidance = {(year, province): {self.references[index][0] for index in ids} for year, province, ids in preview['preview']}
            self.assertEqual(actual_guidance, dict(expected_guidance))

            self.assertEqual(len({r['id'] for r in results}), len(results))
            self.assertEqual(len({r['contest'] for r in results}), len(results))
            provinces = {p for r in results if (p := {'内蒙': '内蒙古', '长沙': '湖南'}.get(r['province'], r['province'])) in PROVINCES}
            self.assertEqual(set(student['provinces']), provinces)
            saw_cross_province |= len(provinces) > 1
            scored = [r for r in results if r['score'] is not None]
            total = sum((Decimal(r['score']) for r in scored), Decimal(0)) if scored else None
            if student['identityStatus'] != 'confirmed':
                total = None
                saw_pending = True
            self.assertEqual(student['score'], str(total) if total is not None else None)
            if total is not None:
                confirmed_scores[student['id']] = total
                saw_zero |= total == 0
                saw_unassigned |= student['coachCount'] == 0
            associated_coaches = set()
            for result in results:
                self.assertEqual(len(result['coachIds']), len(set(result['coachIds'])))
                for cid in result['coachIds']:
                    associated_coaches.add(cid)
                    self.assertEqual(coach_results[cid, result['id']], (student['id'], result['score']))
                    linked_results.add((cid, result['id']))
            self.assertEqual(associated_coaches, {coach['id'] for coach in detail['coaches']})
            self.assertEqual(student['coachCount'], len(associated_coaches))
            if total is None:
                self.assertEqual(detail['history'], [])
                self.assertIsNone(student['currentRank'])
                self.assertIsNone(student['peakRank'])
                continue
            first_year = min(r['year'] for r in scored)
            self.assertEqual([r['year'] for r in detail['history']], list(range(first_year, self.manifest['studentYears'][-1] + 1)))
            for point in detail['history']:
                year = point['year']
                cumulative = sum((Decimal(r['score']) for r in scored if r['year'] <= year), Decimal(0))
                self.assertEqual(Decimal(point['score']), cumulative)
                self.assertEqual(point['population'], snapshots[year]['population'])
                self.assertEqual(snapshot_entries[year][student['id']], {key: point[key] for key in ['studentId', 'rank', 'score']})
            peak = min(detail['history'], key=lambda point: (point['rank'], point['year']))
            self.assertEqual((student['peakRank'], student['peakYear'], student['peakPopulation']), (peak['rank'], peak['year'], peak['population']))
        self.assertEqual(linked_results, set(coach_results))
        self.assertTrue(saw_unassigned and saw_pending and saw_zero and saw_cross_province)
        current_ranks = competition_ranks(confirmed_scores)
        self.assertEqual({s['id']: s['currentRank'] for s in self.index if s['currentRank'] is not None}, current_ranks)
        for year, entries in snapshot_entries.items():
            self.assertEqual(snapshots[year]['population'], len(entries))
            self.assertEqual({sid: entry['rank'] for sid, entry in entries.items()},
                             competition_ranks({sid: Decimal(entry['score']) for sid, entry in entries.items()}))
        self.assertEqual(self.manifest['indexedStudentCount'], len(self.index))
        self.assertEqual(self.manifest['rankedStudentCount'], len(confirmed_scores))
        self.assertEqual(self.manifest['studentYears'][0], 2004)
        self.assertLess(self.manifest['studentYears'][0], self.manifest['years'][0])

    def test_xu_qiwen_ioi_inherits_latest_noi_list(self):
        student = self.detail('oier-82575')
        rows = {r['contest']: r for r in student['results']}
        self.assertEqual(len(rows['NOIP2025']['coachIds']), 1)
        self.assertEqual(len(rows['NOI2026']['coachIds']), 3)
        self.assertEqual(rows['IOI2026']['coachIds'], rows['NOI2026']['coachIds'])
        for cid in rows['IOI2026']['coachIds']:
            coach = json.loads((self.base / 'coaches' / (cid + '.json')).read_text(encoding='utf-8'))
            result = next(r for r in coach['results'] if r['id'] == rows['IOI2026']['id'])
            self.assertEqual(result['attribution']['evidence'], [rows['NOI2026']['id']])

    def test_liu_jiawei_ioi_and_yearly_coach_lists(self):
        student = self.detail('oier-104711')
        self.assertEqual(student['name'], '刘家炜')
        names = {coach['id']: coach['name'] for coach in student['coaches']}
        self.assertEqual(self.manifest['attributionVersion'], ATTRIBUTION_VERSION)
        for result in student['results']:
            expected = {'黄新军', '刘雨俊'} if result['schoolYear'] == 2023 else {'黄新军', '刘雨俊', '党东'}
            self.assertEqual({names[cid] for cid in result['coachIds']}, expected)
        ioi = next(result for result in student['results'] if result['event'] == 'IOI')
        self.assertEqual(Decimal(ioi['score']).quantize(Decimal('.01')), Decimal('28785.89'))
        for cid in ioi['coachIds']:
            coach = json.loads((self.base / 'coaches' / (cid + '.json')).read_text(encoding='utf-8'))
            attributed = next(row for row in coach['results'] if row['id'] == ioi['id'])
            self.assertEqual(attributed['score'], ioi['score'])
            self.assertEqual(attributed['attribution']['type'], 'inferred')

    def test_junior_credit_is_counted_once_with_multiple_coaches(self):
        student = self.detail('oier-149374')
        self.assertEqual(student['name'], '蒋明睿')
        self.assertEqual(len(student['results']), 6)
        self.assertEqual(Decimal(student['score']).quantize(Decimal('.01')), Decimal('68596.43'))
        for result in student['results']:
            self.assertEqual(result['stage'], 'junior')
            self.assertEqual(len(result['coachIds']), 3 if result['event'] == 'NOI' else 0)
        yin = self.detail('oier-86883')
        self.assertEqual({r['stage'] for r in yin['results']}, {'junior', 'senior'})
        for result in yin['results']:
            if result['contest'] == 'APIO2023':
                self.assertEqual(result['schoolYear'], 2022)
                self.assertEqual(result['coachIds'], [])
            else:
                self.assertEqual(len(result['coachIds']), 3)


if __name__ == '__main__':
    unittest.main()
