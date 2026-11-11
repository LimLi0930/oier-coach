"""Normalize downloaded competition evidence and conservatively reconcile records.

Inputs remain in data/source-audit. Outputs are rebuilt in data/cleaned.
"""
import csv
import hashlib
import json
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from contextlib import closing
from decimal import Decimal
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
INPUT = BASE / 'data' / 'source-audit'
OUTPUT = BASE / 'data' / 'cleaned'
PROVINCES = '北京 天津 河北 山西 内蒙古 辽宁 吉林 黑龙江 上海 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 广西 海南 重庆 四川 贵州 云南 西藏 陕西 甘肃 青海 宁夏 新疆 香港 澳门 台湾'.split()
MISSING = {'', '/', '//', '-', '--', '无', '暂无', '不详', '未知', '未填', '(空)', 'None', 'null'}
PRIORITY = {'national_official': 0, 'international_official': 0, 'regional_organizer_attachment': 1,
            'school_report': 2, 'school_published_report': 2,
            'newspaper_profile': 3, 'official_news': 1, 'oierdb': 4,
            'community_repost': 5, 'community_archive': 5}
STANDARD_GRADES = {'初一', '初二', '初三', '高一', '高二', '高三'}


def compact(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(value or ''))).strip()


def text(value):
    value = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or ''))).strip()
    return '' if value in MISSING else value


def identifier(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]


def number(value):
    value = compact(value).replace(',', '')
    if not value or not re.fullmatch(r'-?\d+(?:\.\d+)?', value):
        return ''
    return format(Decimal(value).normalize(), 'f')


def province(value):
    value = compact(value)
    for p in sorted(PROVINCES, key=len, reverse=True):
        if value.startswith(p):
            return p
    return value


def award(value, event):
    value = compact(value)
    if value in ['金', '银', '铜']:
        return value + '牌'
    for pattern, name in [('金牌|金奖|Gold', '金牌'), ('银牌|银奖|Silver', '银牌'),
                          ('铜牌|铜奖|Bronze', '铜牌'), ('一等奖', '一等奖'),
                          ('二等奖', '二等奖'), ('三等奖', '三等奖')]:
        if re.search(pattern, value, re.I):
            if event in ['NOI', 'WC', 'APIO']:
                return {'一等奖': '金牌', '二等奖': '银牌', '三等奖': '铜牌'}.get(name, name)
            return name
    return ''


def grade(value):
    value = compact(value)
    return {'1': '初一', '2': '初二', '3': '初三', '4': '高一', '5': '高二', '6': '高三',
            '七年级': '初一', '八年级': '初二', '九年级': '初三'}.get(value, value)


def expanded_rows(table, repairs=None):
    pending = {}
    header = next((r for r in table if any(column(c['text']) == 'student' for c in r)), [])
    width = sum(max(1, int(c.get('colspan') or 1)) for c in header)
    for row_index, raw in enumerate(table):
        raw_width = sum(max(1, int(c.get('colspan') or 1)) for c in raw)
        if pending and width and raw_width >= width:
            if repairs is not None:
                repairs.append(row_index)
            pending = {}
        cells = {i: value for i, (value, _) in pending.items()}
        following = {i: (value, left - 1) for i, (value, left) in pending.items() if left > 1}
        index = 0
        for cell in raw:
            while index in cells:
                index += 1
            cell_width = max(1, int(cell.get('colspan') or 1))
            height = max(1, int(cell.get('rowspan') or 1))
            for offset in range(cell_width):
                cells[index + offset] = cell['text']
                if height > 1:
                    following[index + offset] = (cell['text'], height - 1)
            index += cell_width
        pending = following
        yield [cells.get(i, '') for i in range(max(cells, default=-1) + 1)]


def column(name):
    name = compact(name)
    if name in ['姓名', '选手姓名', 'Contestant']:
        return 'student'
    if name in ['省份', '省队名称']:
        return 'province'
    if name == 'Member':
        return 'country'
    if name.startswith(('学校', '所在学校', '就读学校')):
        return 'school'
    if name.startswith(('年级', '就读年级')):
        return 'grade'
    if name in ['总分', '得分', 'Score▼', 'Score', 'Abs.']:
        return 'score'
    if name.startswith(('实际总分', '实际得分', '实际成绩')):
        return 'actual_score'
    if '指导教' in name or '辅导教' in name:
        return 'coach_raw'
    return {'性别': 'gender', '证书编号': 'certificate', '奖项': 'award', '奖牌': 'award',
            'Award': 'award', '组别': 'category', '名次': 'rank', 'Rank': 'rank'}.get(name)


class Cleaner:
    def __init__(self):
        self.observations = []
        self.issues = []
        self.sources = {}
        self.audit = []
        self.observation_by_id = {}
        self.repeated_input_rows = 0

    def issue(self, kind, reference, detail):
        self.issues.append({'kind': kind, 'reference': reference, 'detail': detail})

    def add(self, row, source_url, source_type, location, raw):
        row = dict(row)
        row.setdefault('variant', 'main')
        row.setdefault('group', '')
        row.setdefault('award_scope', 'international' if row['event'] == 'IOI' else 'domestic')
        for field in ['student', 'school', 'coach_raw', 'gender', 'certificate', 'country', 'category']:
            row[field] = text(row.get(field))
        row['student'] = re.sub(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])', '', row['student'])
        if row['event'] == 'NOI':
            row['student'] = re.sub(r'^\d+(?=[\u3400-\u9fff])', '', row['student'])
        row['province'] = province(row.get('province'))
        row['grade'] = grade(row.get('grade'))
        row['score'] = number(row.get('score'))
        row['actual_score'] = number(row.get('actual_score'))
        row['award_raw'] = text(row.get('award'))
        row['award'] = award(row.get('award'), row['event'])
        row['eligibility'] = 'disqualified' if '取消获奖资格' in str(raw) else 'listed'
        if row['eligibility'] == 'disqualified':
            row['award'] = ''
            row['award_raw'] = ''
            row['coach_raw'] = ''
        if '国际' in row['award_raw']:
            row['award_scope'] = 'international'
        sid = identifier(source_url)
        self.sources.setdefault(sid, {'source_id': sid, 'url': source_url, 'type': source_type})
        oid = identifier([source_url, location])
        row.update(observation_id=oid, source_id=sid, source_type=source_type,
                   source_location=location, raw=raw)
        if not row['student']:
            self.issue('missing_student', oid, raw)
            return
        if row['event'] != 'IOI' and not row['award'] and row['eligibility'] != 'disqualified':
            self.issue('missing_award', oid, raw)
        previous = self.observation_by_id.get(oid)
        if previous is not None:
            assert previous == row, f'Different observations share a source location: {source_url} {location}'
            self.repeated_input_rows += 1
            return
        self.observation_by_id[oid] = row
        self.observations.append(row)

    def load_oierdb(self):
        contests = {c['name']: c for c in json.loads((INPUT / 'oierdb-contests.json').read_text(encoding='utf-8'))}
        count = Counter()
        url = 'https://raw.githubusercontent.com/OIerDb-ng/OIerDb/master/data/raw.txt'
        with (INPUT / 'oierdb-raw.txt').open(encoding='utf-8', newline='') as file:
            for lineno, values in enumerate(csv.reader(file), 1):
                if not values or values[0].startswith('#'):
                    continue
                meta = contests.get(values[0])
                if not meta:
                    self.issue('unknown_contest', lineno, values)
                    continue
                kind = meta['type']
                event = next((e for e in ['NOIP', 'NOI', 'APIO', 'WC', 'IOI'] if kind.startswith(e)), '')
                if not event or kind in ['NOIST']:
                    count['outside_five_events'] += 1
                    continue
                row = dict(event=event, year=meta['year'], group='', student=values[2], award=values[1],
                           grade=values[3], school=values[4], score=values[5], province=values[6],
                           gender=values[7] if len(values) > 7 else '')
                if event == 'NOIP':
                    row['group'] = '普及组' if '普及' in kind else ('提高组' if '提高' in kind else '统一组')
                row['variant'] = 'invitational' if kind == 'NOID类' else ('ai' if kind == 'WC-AI' else 'main')
                if event == 'APIO' and '线上' in meta['name']:
                    row['variant'] = 'online'
                self.add(row, url, 'oierdb', lineno, values)
                count['imported'] += 1
        self.audit.append({'input': 'oierdb', **count})

    def load_tables(self):
        documents = json.loads((INPUT / 'documents.json').read_text(encoding='utf-8'))
        by_url = {d['url']: d for d in documents}
        for doc in documents:
            if not doc.get('table_count'):
                continue
            tables = json.loads((INPUT / doc['tables_path']).read_text(encoding='utf-8'))
            parent = by_url.get(doc.get('parent_url'), {})
            source_count = 0
            for table_index, table in enumerate(tables):
                first_header = next((i for i, r in enumerate(table) if any(column(c['text']) == 'student' for c in r)), None)
                if first_header is None:
                    continue
                preamble = ' '.join(c['text'] for r in table[:first_header] for c in r)
                # The file's own heading takes precedence over the announcement link's label.
                context = preamble or doc.get('source_heading', '') or doc['title']
                title_context = context + ' ' + parent.get('title', '')
                event = doc['event']
                group = ''
                if event == 'NOIP':
                    group = '普及组' if '普及' in context else ('提高组' if '提高' in title_context else '')
                    if doc['year'] >= 2020:
                        group = '统一组'
                variant = 'invitational' if re.search('邀请赛|夏令营|D类', compact(context)) else 'main'
                if '线上类别' in context:
                    variant = 'online'
                if event == 'WC' and re.search(r'AI|人工智能', context + ' ' + doc['url'], re.I):
                    variant = 'ai'
                current_award = award(title_context, event)
                current_scope = 'international' if event == 'IOI' else 'domestic'
                mapping = {}
                span_repairs = []
                for row_index, values in enumerate(expanded_rows(table, span_repairs)):
                    raw_values = [c['text'] for c in table[row_index]]
                    if any(column(v) == 'student' for v in values):
                        mapping = {}
                        for i, value in enumerate(values):
                            field = column(value)
                            if field and field not in mapping:
                                mapping[field] = i
                        if doc['url'].split('&')[0] == 'https://www.noi.cn/ccf/file/do?fid=RfRYN8Dh' and mapping.get('award') == 6:
                            mapping['coach_raw'] = mapping.pop('award')
                            self.issue('repaired_source_header', [doc['url'], table_index, row_index],
                                       '第7列表头为奖牌，整段数据为指导教师姓名，按同表前段结构修正。')
                        continue
                    section = ' '.join(dict.fromkeys(text(v) for v in raw_values if text(v)))
                    nonempty = list(dict.fromkeys(text(v) for v in raw_values if text(v)))
                    if len(nonempty) <= 2 and award(section, event):
                        current_award = award(section, event)
                        current_scope = 'international' if '国际' in section else ('international' if event == 'IOI' else 'domestic')
                        continue
                    if not mapping or mapping['student'] >= len(values):
                        continue
                    student = text(values[mapping['student']])
                    if not student:
                        continue
                    if len(nonempty) < 2 or not re.search(r'[\u3400-\u9fffA-Za-z]', student):
                        continue
                    row = {field: values[i] for field, i in mapping.items() if i < len(values)}
                    # Common secondary headers and explanatory merged rows are not participants.
                    if student in ['姓名', '选手姓名', 'Contestant'] or '获奖名单' in student:
                        continue
                    row.update(event=event, year=doc['year'], group=group, variant=variant,
                               award_scope=current_scope)
                    row['award'] = row.get('award') or current_award
                    if event == 'IOI' and not row['award']:
                        row['award'] = ''
                    if not row.get('province'):
                        label = compact(doc['title'])
                        row['province'] = next((p for p in PROVINCES if label == p), '')
                    self.add(row, doc['url'], 'international_official' if event == 'IOI' else 'national_official',
                             [table_index, row_index], raw_values)
                    source_count += 1
                if span_repairs:
                    self.issue('repaired_rowspan_overflow', [doc['url'], table_index], span_repairs)
            self.audit.append({'input': doc['url'], 'imported': source_count})

    def load_external(self):
        path = INPUT / 'external'
        rows = json.loads((path / 'coach-records.json').read_text(encoding='utf-8'))
        for index, row in enumerate(rows):
            if row.get('source_line'):
                match = re.match(r'^\S+\s+\d+\s+(男|女)\s+(.+?)\s+((?:初|高)\S+|普及组|\d+)\s+(?:pascal|p|c\+\+|c)(?:\s+|$)', row['source_line'], re.I)
                if match:
                    row.update(gender=match[1], school=match[2], grade=match[3])
                else:
                    self.issue('external_row_layout', [row['source_url'], index], row['source_line'])
            self.add(row, row['source_url'], row['evidence_type'], ['external', index], row.copy())
        # School-level coach teams are kept in source evidence without assigning each teacher to each student.
        evidence = json.loads((path / 'noip2004_school_evidence.json').read_text(encoding='utf-8'))
        for key, group, prize in [('senior_first', '提高组', '一等奖'), ('senior_second', '提高组', '二等奖'),
                                  ('junior_first', '普及组', '一等奖'), ('junior_second', '普及组', '二等奖')]:
            for name in evidence[key]:
                self.add(dict(event='NOIP', year=2004, group=group, student=name, award=prize,
                              school=evidence['school'], province='河南'), evidence['source_url'],
                         'school_report', [key, name], evidence)
        self.load_old_texts(path)
        for source in json.loads((INPUT / 'supplementary.json').read_text(encoding='utf-8')):
            if source['event'] == 'APIO':
                # Checked against the six named international gold medalists in
                # the independently downloaded APIO2010 official results table.
                news_schools = {
                    '福建省福州一中': ('福建', '福州一中'),
                    '浙江省绍兴一中': ('浙江', '绍兴一中'),
                    '辽宁省东北育才中学': ('辽宁', '东北育才学校'),
                    '福建省厦门双十中学': ('福建', '厦门双十中学'),
                    '江苏南京外国语学校': ('江苏', '南京外国语学校'),
                }
                pattern = r'国际金牌获得者([^()\s]+)\(\s*所在学校[:：](.*?)；指导教师[:：](.*?)\)'
                for index, match in enumerate(re.finditer(pattern, source['text'], re.S)):
                    region, school = news_schools.get(compact(match[2]), ('', match[2]))
                    self.add(dict(event='APIO', year=2010, student=match[1], school=school, province=region,
                                  coach_raw=match[3], award='国际金牌',
                                  normalization_note='校名按同年同奖项官方名单中的同名选手对照，原文保留在raw'), source['url'], 'official_news',
                             ['news', index], match[0])

    def load_old_texts(self, path):
        url = 'https://bbs.oifans.cn/read.php?ds=1&tid=193'
        region = ''
        for i, line in enumerate((path / 'noip2005_national.txt').read_text(encoding='utf-8').splitlines()):
            match = re.match(r'(.+?)\s*获奖人数', line)
            if match:
                region = province(match[1])
            match = re.match(r'(.+?)\s+(I\d+)\s+(.+?)\s+(\d+)\s*$', line)
            if match:
                self.add(dict(event='NOIP', year=2005, group='提高组', student=match[1].rstrip('*'),
                              certificate=match[2], school=match[3], score=match[4], province=region,
                              award='一等奖'), url, 'community_repost', ['line', i], line)
        # The archive contains damaged parentheses. Parse recoverable name/province pairs and retain the remainder for review.
        body = (path / 'noip2001.txt').read_text(encoding='utf-8')
        body = body.split('自左至右排列', 1)[-1].split('128名同学', 1)[0]
        url = 'https://raw.githubusercontent.com/Wallbreaker5th/www.mydrs.org/main/www.mydrs.org/list-id=333.htm'
        matches = list(re.finditer(r'([\u3400-\u9fff]{2,5})[（(](' + '|'.join(PROVINCES) + r')[)）(l]?', body))
        for i, match in enumerate(matches):
            self.add(dict(event='NOIP', year=2001, group='普及组', student=match[1], province=match[2],
                          award='一等奖'), url, 'community_archive', ['pair', i], match[0])
        self.issue('archive_transcription', url, {'declared_rows': 75, 'parsed_rows': len(matches), 'text': body})
        # Word's text export separates cells with U+0007 and rows with an additional empty cell.
        body = (path / 'NOIP2008浙江.txt').read_text(encoding='utf-8')
        cells = [c.strip() for c in body.split('\x07')]
        group = ''
        prize = ''
        count = 0
        url = 'https://www.xiaoxiaotong.org/AttachFile/400521/633713236001505000.doc'
        for i, cell in enumerate(cells):
            if '提高组' in cell:
                group = '提高组'
            if '普及组' in cell:
                group = '普及组'
            prize = award(cell, 'NOIP') or prize
            if i + 4 >= len(cells) or not cell.isdigit():
                continue
            if not re.fullmatch(r'[A-Za-z]+[-－]?\d+', compact(cells[i + 2])):
                continue
            self.add(dict(event='NOIP', year=2008, group=group, award=prize, student=cells[i + 1],
                          province='浙江', school=cells[i + 3], certificate=cells[i + 4]),
                     url, 'regional_organizer_attachment', ['cell', i], cells[i:i + 5])
            count += 1
        self.audit.append({'input': 'NOIP2008浙江.doc', 'imported': count, 'expected': 794})

    def reconcile(self):
        results = []
        names_index = defaultdict(list)
        certificate_index = {}
        # Authoritative tables are processed first. Each observation remains available for auditing.
        for obs in sorted(self.observations, key=lambda o: (PRIORITY.get(o['source_type'], 3), o['source_id'], str(o['source_location']))):
            block = (obs['event'], obs['year'], obs['variant'], obs['group'], obs['award_scope'], compact(obs['student']))
            candidates = [r for r in names_index[block] if self.compatible(r, obs)]
            certkey = (*block[:5], obs['province'], obs['certificate'])
            exact = certificate_index.get(certkey) if obs['certificate'] else None
            if exact and compact(exact['student']) != compact(obs['student']):
                self.issue('certificate_name_conflict', obs['observation_id'], {'other_record': exact['result_id']})
                exact = None
            target = exact or (candidates[0] if len(candidates) == 1 else None)
            if target is None:
                if candidates:
                    self.issue('ambiguous_record_match', obs['observation_id'], [r['result_id'] for r in candidates])
                fields = ['event', 'year', 'variant', 'group', 'award_scope', 'student', 'province', 'country',
                          'school', 'grade', 'gender', 'award', 'score', 'actual_score', 'certificate']
                target = {field: obs.get(field, '') for field in fields}
                target.update(result_id=identifier(['result', obs['observation_id']]), observation_ids=[],
                              source_ids=[], coach_evidence=[], field_variants={}, eligibility=obs['eligibility'])
                results.append(target)
                names_index[block].append(target)
            for field in ['school', 'grade', 'gender', 'award', 'score', 'actual_score', 'certificate', 'province', 'country']:
                value = obs.get(field)
                if not value:
                    continue
                if not target[field]:
                    target[field] = value
                elif compact(target[field]) != compact(value):
                    values = target['field_variants'].setdefault(field, [target[field]])
                    if value not in values:
                        values.append(value)
                        if field in ['award', 'score', 'gender']:
                            self.issue('field_conflict', target['result_id'], {'field': field, 'values': values, 'observation': obs['observation_id']})
            target['observation_ids'].append(obs['observation_id'])
            if obs['eligibility'] == 'disqualified':
                target['eligibility'] = 'disqualified'
                target['award'] = ''
            if obs['source_id'] not in target['source_ids']:
                target['source_ids'].append(obs['source_id'])
            if obs['coach_raw'] and obs['eligibility'] != 'disqualified':
                target['coach_evidence'].append({'raw': obs['coach_raw'], 'observation_id': obs['observation_id'],
                                                'source_id': obs['source_id'], 'source_type': obs['source_type']})
            obs['result_id'] = target['result_id']
            if obs['certificate']:
                certificate_index.setdefault(certkey, target)
        for result in results:
            if result['eligibility'] == 'disqualified':
                result['award'] = ''
                result['coach_evidence'] = []
                self.issue('disqualified_result', result['result_id'], '源名单明确取消获奖资格。')
        return results

    @staticmethod
    def compatible(result, obs):
        if obs['source_id'] in result['source_ids']:
            # Two different rows in one source can be different students with the same name.
            same_certificate = bool(obs['certificate']) and obs['certificate'] == result['certificate']
            identity_fields = ['school', 'grade', 'score', 'award', 'certificate', 'gender']
            if not same_certificate and any(compact(result.get(f)) != compact(obs.get(f)) for f in identity_fields):
                return False
        for field in ['province', 'country', 'award', 'gender']:
            if result.get(field) and obs.get(field) and result[field] != obs[field]:
                return False
        school_equal = compact(result['school']) == compact(obs['school']) and bool(result['school'])
        if result['score'] and obs['score'] and result['score'] != obs['score']:
            return False
        if school_equal:
            return not (result['grade'] in STANDARD_GRADES and obs['grade'] in STANDARD_GRADES and result['grade'] != obs['grade'])
        # A unique cross-source match requires agreement on score and province.
        if result['score'] and result['score'] == obs['score'] and result['province'] and result['province'] == obs['province']:
            return True
        return False

    def attach_coaches(self, results):
        mentions = []
        known_names = defaultdict(set)
        for result in results:
            if not result['school']:
                continue
            for evidence in result['coach_evidence']:
                names, _ = split_coaches(evidence['raw'])
                known_names[(result['province'], compact(result['school']))].update(names)
        for result in results:
            sets = []
            for evidence in result['coach_evidence']:
                names, unresolved = split_coaches(evidence['raw'])
                still_unresolved = []
                for part in unresolved:
                    splits = segment_names(compact(part), known_names[(result['province'], compact(result['school']))])
                    if len(splits) == 1 and len(splits[0]) > 1:
                        names.extend(splits[0])
                        evidence.setdefault('school_corroborated_splits', []).append({'raw': part, 'names': splits[0]})
                    else:
                        still_unresolved.append(part)
                unresolved = still_unresolved
                names = sorted(set(names))
                evidence.update(names=names, unresolved=unresolved)
                if unresolved:
                    self.issue('ambiguous_coach_text', result['result_id'], evidence)
                if names:
                    sets.append(set(names))
                for name in names:
                    mentions.append({'result_id': result['result_id'], 'coach_name': name,
                                     'school_context': result['school'], 'province_context': result['province'],
                                     'observation_id': evidence['observation_id'], 'source_id': evidence['source_id'],
                                     'source_type': evidence['source_type']})
            result['coach_names'] = sorted(set().union(*sets)) if sets else []
            result['coach_status'] = 'missing' if not result['coach_evidence'] else 'parsed'
            if any(e['unresolved'] for e in result['coach_evidence']):
                result['coach_status'] = 'review'
            if len({tuple(sorted(s)) for s in sets}) > 1:
                result['coach_status'] = 'review'
                self.issue('coach_source_difference', result['result_id'], result['coach_evidence'])
        return mentions

    def flag_identity_questions(self, results):
        blocks = defaultdict(list)
        for row in results:
            blocks[(row['event'], row['year'], row['variant'], row['group'], row['award_scope'],
                    compact(row['student']), row['province'])].append(row)
        for key, rows in blocks.items():
            if len(rows) > 1:
                self.issue('same_name_separate_records', [r['result_id'] for r in rows],
                           {'competition_name_province': key, 'reason': '学校、年级、成绩或奖项存在差异，保留独立记录供核对'})
        # IOI's international source uses Romanized names. Expose exact score candidates
        # without turning a matching score into an asserted bilingual identity.
        international = defaultdict(list)
        for row in results:
            if row['event'] == 'IOI' and re.search('[A-Za-z]', row['student']):
                international[(row['year'], row['award'], row['score'])].append(row)
        for row in results:
            if row['event'] == 'IOI' and re.search('[\u3400-\u9fff]', row['student']):
                candidates = international[(row['year'], row['award'], row['score'])] if row['score'] else []
                self.issue('ioi_bilingual_identity', row['result_id'],
                           {'student': row['student'], 'candidates': [r['result_id'] for r in candidates],
                            'reason': '国际表姓名与中文姓名的对应关系待核对'})
        by_observation = {o['observation_id']: o['result_id'] for o in self.observations}
        by_result = {r['result_id']: r for r in results}
        for row in results:
            row['review_flags'] = []
            if all(self.sources[s]['type'] in ['community_repost', 'community_archive'] for s in row['source_ids']):
                row['review_flags'].append('community_source_unverified')
        for issue in self.issues:
            refs = issue['reference'] if isinstance(issue['reference'], list) else [issue['reference']]
            for reference in refs:
                if not isinstance(reference, str):
                    continue
                result_id = by_observation.get(reference, reference)
                if result_id in by_result:
                    flags = by_result[result_id]['review_flags']
                    if issue['kind'] not in flags:
                        flags.append(issue['kind'])


def coach_links(mentions):
    grouped = {}
    for mention in mentions:
        key = (mention['result_id'], mention['coach_name'])
        row = grouped.setdefault(key, {'result_id': key[0], 'coach_name': key[1],
                                      'school_context': mention['school_context'],
                                      'province_context': mention['province_context'],
                                      'observation_ids': [], 'source_ids': []})
        for singular, plural in [('observation_id', 'observation_ids'), ('source_id', 'source_ids')]:
            if mention[singular] not in row[plural]:
                row[plural].append(mention[singular])
    return list(grouped.values())


def write_database(results, observations, sources, links, issues, coverage):
    temporary = OUTPUT / 'competitions.building.sqlite'
    if temporary.exists():
        temporary.unlink()
    with closing(sqlite3.connect(temporary)) as db, db:
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript('''
            CREATE TABLE sources(source_id TEXT PRIMARY KEY, url TEXT NOT NULL, type TEXT NOT NULL);
            CREATE TABLE results(result_id TEXT PRIMARY KEY, event TEXT, year INTEGER, variant TEXT,
                contest_group TEXT, award_scope TEXT, student TEXT, province TEXT, country TEXT, school TEXT,
                grade TEXT, gender TEXT, award TEXT, score TEXT, actual_score TEXT, certificate TEXT,
                eligibility TEXT, coach_status TEXT, needs_review INTEGER, detail_json TEXT NOT NULL);
            CREATE TABLE observations(observation_id TEXT PRIMARY KEY, result_id TEXT REFERENCES results,
                source_id TEXT REFERENCES sources, detail_json TEXT NOT NULL);
            CREATE TABLE coach_links(result_id TEXT REFERENCES results, coach_name TEXT, school_context TEXT,
                province_context TEXT, evidence_json TEXT, PRIMARY KEY(result_id, coach_name));
            CREATE TABLE issues(issue_id INTEGER PRIMARY KEY, kind TEXT, reference_json TEXT, detail_json TEXT);
            CREATE TABLE coverage(event TEXT, year INTEGER, variant TEXT, contest_group TEXT,
                award_scope TEXT, results INTEGER, with_coach_evidence INTEGER, coach_parsed INTEGER, coach_review INTEGER);
            CREATE INDEX result_event_year ON results(event, year);
            CREATE INDEX result_student ON results(student, province);
            CREATE INDEX coach_name_school ON coach_links(coach_name, school_context);
        ''')
        db.executemany('INSERT INTO sources VALUES(?,?,?)', [(s['source_id'], s['url'], s['type']) for s in sources])
        keys = ['result_id', 'event', 'year', 'variant', 'group', 'award_scope', 'student', 'province', 'country',
                'school', 'grade', 'gender', 'award', 'score', 'actual_score', 'certificate', 'eligibility', 'coach_status']
        db.executemany('INSERT INTO results VALUES(' + ','.join('?' for _ in range(20)) + ')',
                       [tuple(r[k] for k in keys) + (bool(r['review_flags']), json.dumps(r, ensure_ascii=False)) for r in results])
        db.executemany('INSERT INTO observations VALUES(?,?,?,?)',
                       [(o['observation_id'], o['result_id'], o['source_id'], json.dumps(o, ensure_ascii=False)) for o in observations])
        db.executemany('INSERT INTO coach_links VALUES(?,?,?,?,?)',
                       [(l['result_id'], l['coach_name'], l['school_context'], l['province_context'],
                         json.dumps(l, ensure_ascii=False)) for l in links])
        db.executemany('INSERT INTO issues(kind,reference_json,detail_json) VALUES(?,?,?)',
                       [(i['kind'], json.dumps(i['reference'], ensure_ascii=False), json.dumps(i['detail'], ensure_ascii=False)) for i in issues])
        db.executemany('INSERT INTO coverage VALUES(?,?,?,?,?,?,?,?,?)',
                       [tuple(c[k] for k in ['event', 'year', 'variant', 'group', 'award_scope', 'results',
                                            'with_coach_evidence', 'coach_parsed', 'coach_review']) for c in coverage])
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    temporary.replace(OUTPUT / 'competitions.sqlite')


def write_report(summary, results, coverage):
    lines = ['数据汇总与清洗结果', '处理日期 2026-11-09', '',
             '本次汇总此前取得的NOI、NOIP、WC、APIO和IOI资料，包含对应邀请赛、线上类别及WC AI组。IOI保留全球成绩记录。',
             '原始OIerDB中的CSP、CTSC、女生赛等其他赛事保留在原始文件中，本次汇总范围为以上五类赛事。', '',
             f"来源记录 {summary['observations']:,} 条，来源 {summary['sources']} 个。",
             f"另移除重复导入的相同来源行 {summary['repeated_input_rows']:,} 条。",
             f"合并后成绩记录 {summary['results']:,} 条，合并重复来源记录 {summary['consolidated_observations']:,} 条。",
             f"有教练原文的成绩记录 {summary['with_coach_evidence']:,} 条。",
             f"教练字段已解析 {summary['coach_parsed']:,} 条，教练字段待核对 {summary['coach_review']:,} 条。",
             f"去除重复证据后的选手成绩—教练姓名关联 {summary['coach_links']:,} 条。",
             '教练关联数量按姓名与单次成绩计算，跨学校同名教练的人物身份仍待核对。', '', '赛事汇总', '']
    for event, count in summary['events'].items():
        selected = [r for r in results if r['event'] == event]
        years = sorted({r['year'] for r in selected})
        lines.append(f"{event}  {count:,}条成绩  {sum(bool(r['coach_evidence']) for r in selected):,}条带教练原文  年份 {', '.join(map(str, years))}")
    lines.extend(['', '清洗规则',
                  '1. 规范Unicode全半角、空白和缺失值，中文姓名清除字间排版空格，保留原始单元格。',
                  '2. 赛事、年份、组别、邀请赛、线上及AI类别、奖项层级分别保存，APIO国际奖与中国区奖分别保留。',
                  '3. 标准年级写法归一，含入学年、毕业年等歧义的年级原文保留。学校只作字符规范化，同记录不同校名写法保存在field_variants。',
                  '4. 重复记录优先按赛事类别和证书匹配，或按姓名、省份、学校、成绩等一致字段匹配。跨校名写法匹配需同赛事同姓名同省份同分数且候选唯一。',
                  '5. 同名但学校、成绩、奖项等存在冲突的独立记录保留，并列入核对清单。字段采用全国官方、地区原件、学校报道、新闻、OIerDB、社区转载的来源顺序。同级按来源标识稳定排序，差异值保留。',
                  '6. 教练按明确分隔符拆分。连写姓名仅在同省同学校存在独立姓名证据且能唯一拆分时处理，余项保留原文。',
                  '7. 学校级教师团队保留在源证据中，个人师生关系以具名证据建立。社区转载记录带待复核标记。',
                  '8. 已修正WC2026、部分NOIP2025网页的异常rowspan，以及NOI2014误标的指导教师列表头，修正行号写入issues。',
                  '9. 原文标注取消获奖资格的记录设为disqualified，奖项及教练字段留空。', '',
                  '仍需核对的内容',
                  'IOI中文记录与国际成绩的罗马字姓名保留对应候选，人物对应尚待核对，统计中国选手时需先选定来源范围。',
                  'NOIP2001历史存档有转录损坏，已解析部分逐人记录，剩余文本及原文75人的声明保存在核对清单。',
                  '教练字段解析成功只表示格式已整理，来源真实性、同名教练身份和各年覆盖完整度另有标记。', '', '核对与修正分类', ''])
    lines.extend(f'{kind}  {count}' for kind, count in sorted(summary['issues'].items()))
    lines.extend(['', '交付文件',
                  'competitions.sqlite 可查询数据库，包含results、observations、sources、coach_links、issues和coverage表。',
                  'results.jsonl 统一成绩记录，保留来源ID、原始记录ID、字段差异、教练证据及核对标记。',
                  'observations.jsonl 各来源逐行证据及清洗前字段。',
                  'coach_links.jsonl 去重后的成绩—教练姓名关系。',
                  'sources.jsonl 来源ID到网址与类型的映射。',
                  'issues.jsonl 待核对项及已完成的结构修正日志。',
                  'coverage.jsonl 按赛事、年份、组别、赛道和奖项范围统计的数据覆盖。',
                  'summary.json 汇总统计与逐文件导入计数。', '',
                  '复现命令', 'python scripts/clean_data.py', '', '逐年覆盖', ''])
    for c in coverage:
        lines.append(f"{c['event']} {c['year']} {c['variant']} {c['group']} {c['award_scope']}  成绩{c['results']}  带教练{c['with_coach_evidence']}  教练待核对{c['coach_review']}")
    (OUTPUT / '清洗报告.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def split_coaches(value):
    value = text(value)
    if not value or compact(value) in MISSING:
        return [], []
    names, unresolved = [], []
    parts = re.split(r'[、,;；/／\n\r]+', value)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        words = part.split()
        joined = ''.join(words)
        if re.fullmatch(r'[\u3400-\u9fff]{2,3}', joined):
            names.append(joined)
        elif re.fullmatch(r'[\u3400-\u9fff]+[·•][\u3400-\u9fff·•]+', joined):
            names.append(joined.replace('•', '·'))
        elif re.fullmatch(r'[A-Za-z][A-Za-z .\-]+', part):
            names.append(part)
        elif re.fullmatch(r'(?:欧阳|歐陽|司马|司馬|上官|诸葛|東方|东方|皇甫|尉迟|公孙|慕容|令狐|司徒|司空|夏侯|南宫|端木)[\u3400-\u9fff]{1,2}', joined):
            names.append(joined)
        elif len(parts) > 1 and re.fullmatch(r'[\u3400-\u9fff]{4}', joined):
            names.append(joined)
        elif len(words) > 1 and all(re.fullmatch(r'[\u3400-\u9fff]{2,3}', w) for w in words):
            names.extend(words)
        else:
            # Four-character strings can be one compound-surname name or two people.
            unresolved.append(part)
    return sorted(set(names)), unresolved


def segment_names(value, known):
    if not value or len(value) > 20:
        return []
    paths = {0: [[]]}
    for start in range(len(value)):
        for path in paths.get(start, []):
            for size in [2, 3, 4]:
                name = value[start:start + size]
                if len(name) == size and name in known:
                    target = paths.setdefault(start + size, [])
                    if len(target) < 2:
                        target.append(path + [name])
    return paths.get(len(value), [])


def dump_lines(path, rows):
    with path.open('w', encoding='utf-8', newline='\n') as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + '\n')


def main():
    OUTPUT.mkdir(exist_ok=True)
    cleaner = Cleaner()
    cleaner.load_oierdb()
    cleaner.load_tables()
    cleaner.load_external()
    print('Observations', len(cleaner.observations), flush=True)
    results = cleaner.reconcile()
    mentions = cleaner.attach_coaches(results)
    links = coach_links(mentions)
    cleaner.flag_identity_questions(results)
    coverage = []
    grouped = defaultdict(list)
    for row in results:
        grouped[(row['event'], row['year'], row['variant'], row['group'], row['award_scope'])].append(row)
    for key, rows in sorted(grouped.items()):
        coverage.append(dict(zip(['event', 'year', 'variant', 'group', 'award_scope'], key),
                             results=len(rows), with_coach_evidence=sum(bool(r['coach_evidence']) for r in rows),
                             coach_parsed=sum(r['coach_status'] == 'parsed' for r in rows),
                             coach_review=sum(r['coach_status'] == 'review' for r in rows)))
    sources = list(cleaner.sources.values())
    for name, rows in [('results', results), ('observations', cleaner.observations), ('coach_links', links),
                       ('sources', sources), ('issues', cleaner.issues), ('coverage', coverage)]:
        dump_lines(OUTPUT / (name + '.jsonl'), rows)
    summary = {'observations': len(cleaner.observations), 'results': len(results),
               'repeated_input_rows': cleaner.repeated_input_rows,
               'consolidated_observations': len(cleaner.observations) - len(results),
               'with_coach_evidence': sum(bool(r['coach_evidence']) for r in results),
               'coach_parsed': sum(r['coach_status'] == 'parsed' for r in results),
               'coach_review': sum(r['coach_status'] == 'review' for r in results),
               'coach_links': len(links), 'sources': len(sources),
               'issues': dict(Counter(x['kind'] for x in cleaner.issues)),
               'events': dict(Counter(r['event'] for r in results)), 'input_audit': cleaner.audit}
    (OUTPUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    assert len({o['observation_id'] for o in cleaner.observations}) == len(cleaner.observations)
    assert all(r['student'] for r in results)
    assert all(r['award'] or r['event'] == 'IOI' or r['eligibility'] == 'disqualified' for r in results)
    assert next(a for a in cleaner.audit if a['input'] == 'NOIP2008浙江.doc')['imported'] == 794
    assert sum(o['event'] == 'NOIP' and o['year'] == 2025 and o['source_type'] == 'national_official'
               for o in cleaner.observations) == 5074
    assert sum(o['event'] == 'WC' and o['year'] == 2026 and o['source_type'] == 'national_official' and o['variant'] == 'main'
               for o in cleaner.observations) == 340
    assert sum(o['event'] == 'WC' and o['year'] == 2026 and o['source_type'] == 'national_official' and o['variant'] == 'ai'
               for o in cleaner.observations) == 19
    write_database(results, cleaner.observations, sources, links, cleaner.issues, coverage)
    write_report(summary, results, coverage)
    old_mentions = OUTPUT / 'coach_mentions.jsonl'
    if old_mentions.exists():
        old_mentions.unlink()
    print(json.dumps({k: v for k, v in summary.items() if k != 'input_audit'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
