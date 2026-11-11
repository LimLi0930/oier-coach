"""Build a year-by-year inventory from downloaded sources, without ranking coaches."""
import json
import re
from collections import Counter
from pathlib import Path

from collect_sources import ROOT, save_json


def year_ranges(years):
    groups = []
    for year in sorted(set(years)):
        if groups and groups[-1][-1] + 1 == year:
            groups[-1].append(year)
        else:
            groups.append([year])
    return '、'.join(str(g[0]) if len(g) == 1 else f'{g[0]}—{g[-1]}' for g in groups) or '未获取'


def main():
    documents = json.loads((ROOT / 'documents.json').read_text(encoding='utf-8'))
    external_path = ROOT / 'external' / 'source-manifest.json'
    external = json.loads(external_path.read_text(encoding='utf-8')) if external_path.exists() else []
    contests = json.loads((ROOT / 'oierdb-contests.json').read_text(encoding='utf-8'))
    counts = Counter(line.split(',')[0] for line in (ROOT / 'oierdb-raw.txt').read_text(encoding='utf-8').splitlines()
                     if line.strip() and not line.startswith('#'))
    for doc in documents:
        if not doc.get('tables_path'):
            continue
        tables = json.loads((ROOT / doc['tables_path']).read_text(encoding='utf-8'))
        heading = ' '.join(c['text'] for t in tables[:1] for row in t[:3] for c in row)
        doc['source_heading'] = heading[:500]
        doc['scope'] = 'main'
        if doc['event'] == 'NOI' and re.search('邀请赛|夏令营', heading):
            doc['scope'] = 'invitational'
        if doc['event'] == 'APIO' and '线上类别' in heading:
            doc['scope'] = 'online'
    save_json(ROOT / 'documents.json', documents)
    inventory = []
    for event in ['NOI', 'NOIP', 'WC', 'APIO', 'IOI']:
        selected = [d for d in documents if d['event'] == event and d.get('scope') != 'invitational']
        db_contests = [c for c in contests if c['type'] == event or
                       (event == 'NOIP' and c['type'] in ['NOIP提高', 'NOIP普及']) or
                       (event == 'APIO' and c['type'].startswith('APIO'))]
        extra = [d for d in external if d.get('usable') and event in d['event'].split('/')]
        years = sorted({d['year'] for d in selected} | {c['year'] for c in db_contests} | {d['year'] for d in extra})
        for year in years:
            sources = [d for d in selected if d['year'] == year and d.get('table_count')]
            db = {c['name']: counts[c['name']] for c in db_contests if c['year'] == year and counts[c['name']]}
            inventory.append({
                'event': event, 'year': year,
                'has_downloaded_results': bool(sources or db or any(d['year'] == year for d in extra)),
                'official_result_documents': len(sources),
                'has_official_coach_column': any(d.get('has_coach_column') for d in sources),
                'oierdb_rows_by_contest': db,
                'external_sources': [d for d in extra if d['year'] == year],
                'sources': [{k: d.get(k) for k in ['url', 'title', 'scope', 'raw_path', 'tables_path',
                                                  'has_coach_column', 'source_heading']} for d in sources],
                'unresolved_urls': [d['url'] for d in selected if d['year'] == year and
                                    d.get('parse_status') in ['invalid_resource_id', 'access_challenge', 'binary_pending']]
            })
    save_json(ROOT / 'year-coverage.json', inventory)
    lines = ['竞赛数据获取核验', '核验日期 2026-11-09', '',
             '本轮从 NOI 官网公示目录逐页发现名单，下载公示正文及附件，并补查搜索引擎收录的官方原始文件。',
             'IOI 采用国际成绩数据库，OIerDB 原始数据用于补充获奖记录。',
             '年份表示该年已获取至少一份选手名单。奖项、组别和省份覆盖可能不同。',
             '指导教师列存在的年份中仍有空单元格。多人教练原文和同名教练尚待清洗核对。', '',
             '获取范围汇总', '']
    for event in ['NOI', 'NOIP', 'WC', 'APIO', 'IOI']:
        rows = [x for x in inventory if x['event'] == event]
        lines.extend([event,
                      '  已获取选手名单年份  ' + year_ranges(x['year'] for x in rows if x['has_downloaded_results']),
                      '  已读取官方表格年份  ' + year_ranges(x['year'] for x in rows if x['official_result_documents']),
                      '  已确认指导教师列年份  ' + year_ranges(x['year'] for x in rows if x['has_official_coach_column']), ''])
    if external:
        lines.extend(['外部来源补查已完成一轮，详细结果见 external/补查结果.txt。',
                      'NOIP新增2001年普及组一等奖社区存档，2004年学校获奖资料，2005年全国及四川名单，以及2006—2007年学校教练关系。',
                      'NOIP2008四川提高组416条、普及组201条已从地区原始Word附件提取，其中616条教练字段非空。',
                      'WC2016、WC2021及APIO2016已补入少量具名教练关系，来源和核对结果保存在external/coach-records.json。',
                      '外部材料的学校、地区、奖级覆盖各不相同，社区转载仍有姓名转录及历史版本核对工作。', ''])
    lines.extend(['重要缺口与范围说明',
                  'NOI 2012 官方资源入口返回 ID传入错误，已取得 OIerDB 的225条选手获奖记录，指导教师仍待补充。',
                  'NOI 2002—2006、2008—2010 已下载名单未发现指导教师列。2007有指导教师列。',
                  'NOIP 2008 官方 FTP 附件实测返回502，2009旧下载链接返回502，2010部分旧链接失败，2018官方附件返回访问验证页。这些年份的选手获奖记录已从OIerDB下载。',
                  'NOIP 2020、2022目前下载了含教练的一等奖名单。2021、2025已下载一二三等奖，2023已下载一三等奖，2024已下载一二等奖。其余奖级仍需补原始教练名单。',
                  'NOIP 2011—2017已读取的全国公示表格未发现指导教师列。早年各省奖级覆盖不一致，保留逐文件记录。',
                  'WC 2025官方资源入口失败，已取得OIerDB的357条获奖记录。其他已下载WC官方名单未发现指导教师列。',
                  'APIO 2023本轮官方原表已获取线上类别，现场类别已有OIerDB的199条记录。其他年份包含中国区奖项，部分年份同时列出国际奖项，需要按原始奖项类型处理。',
                  'APIO 2010另存官方新闻，包含6位国际金牌选手的指导教师。',
                  'NOIP 2008另存乐山市科协公开报道，包含当地9位获奖选手及指导教师，属于地区补充材料。',
                  'IOI已下载1989—2026各年国际成绩页，其中包含全球参赛者。该成绩表未含个人指导教师列。',
                  '更早年份或上述缺口可能另有档案，本次结果只陈述实际成功取得的资料。', '',
                  '文件说明',
                  'year-coverage.json 逐赛事逐年索引，包括来源链接、可读表格文件和OIerDB记录数。',
                  'documents.json 每个页面与附件的HTTP状态、内容解析状态、来源和字段核验。',
                  'raw/ 原始响应文件及下载元信息，文件名为来源URL哈希。',
                  'tables/ 从网页抽出的单元格文本，保留合并行列属性，含标题及表头。',
                  'oierdb-raw.txt OIerDB完整上游原始数据，包含本次五类赛事以外的记录。',
                  'oierdb-contests.json OIerDB赛事元信息。',
                  'supplementary.json 地区及新闻补充证据。', '', '逐年核验', ''])
    for row in inventory:
        status = '含指导教师列' if row['has_official_coach_column'] else '官方名单指导教师待补充'
        if row['external_sources']:
            status += '，有外部补充资料'
        db_count = sum(row['oierdb_rows_by_contest'].values())
        lines.append(f"{row['event']} {row['year']}  官方可读表格{row['official_result_documents']}份  OIerDB记录{db_count}条  {status}")
    (ROOT / '获取结果.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines[:35]))
    print('Documents', len(documents), 'year entries', len(inventory), 'OIerDB rows', sum(counts.values()))


if __name__ == '__main__':
    main()
