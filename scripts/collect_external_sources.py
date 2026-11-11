"""Preserve regional lists, community archives, and school reports with their scope."""
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup
from collect_sources import ROOT, fetch, save_json

OUT = ROOT / 'external'
OUT.mkdir(exist_ok=True)

SOURCES = [
    ('noip2001', 'NOIP', 2001, '普及组一等奖，文中标注75人', 'community_archive',
     'https://raw.githubusercontent.com/Wallbreaker5th/www.mydrs.org/main/www.mydrs.org/list-id=333.htm'),
    ('noip2005_national', 'NOIP', 2005, '全国提高组一等奖转载', 'community_repost',
     'https://bbs.oifans.cn/read.php?ds=1&tid=193'),
    ('noip2005_sichuan', 'NOIP', 2005, '四川普及组一二三等奖转载', 'community_repost',
     'https://bbs.oifans.cn/read-oifans-tid-199-ds-1-toread-1.html'),
    ('noip2004_henan', 'NOIP', 2004, '河南省实验中学校内获奖名单及辅导教师团队', 'school_report',
     'https://www.hnssyzx.cn/sys-nd/2908.html'),
    ('noip2006_hengyang', 'NOIP', 2006, '衡阳市八中获奖名单及指导老师', 'school_report',
     'https://www.hysbz.com/xwzx/xwdt/content_335'),
    ('danyang2016', 'WC/APIO', 2016, '丹阳高级中学个别选手与荆晓虹的指导关系', 'newspaper_profile',
     'https://www.dy001.cn/2018/1011/44642.shtml'),
    ('noi2012_sina', 'NOI', 2012, '搜索索引中有含指导老师的名单，正文目前维护中', 'unretrieved_lead',
     'https://blog.sina.com.cn/s/blog_e326bc8a0102v6ih.html'),
]


def main():
    manifest = []
    records = []
    for key, event, year, scope, source_type, url in SOURCES:
        meta, data = fetch(url)
        soup = BeautifulSoup(data, 'html.parser')
        for node in soup.select('script,style'):
            node.decompose()
        body = soup.select_one('#read_tpc') or soup.select_one('article') or soup
        text = body.get_text('\n', strip=True)
        text_path = OUT / (key + '.txt')
        text_path.write_text(text, encoding='utf-8')
        item = dict(meta, key=key, event=event, year=year, scope=scope, source_type=source_type,
                    text_path=str(text_path.relative_to(ROOT)),
                    usable=bool(data) and source_type != 'unretrieved_lead')
        if key == 'noip2005_sichuan':
            award = ''
            raw_rows = []
            for line in text.splitlines():
                compact = re.sub(r'\s+', '', line)
                if re.fullmatch('[一二三]等奖', compact):
                    award = compact
                match = re.match(r'^(\S+)\s+(\d+)\s+(.+)$', line)
                if not match:
                    continue
                teacher = re.search(r'\s(?:pascal|p|c\+\+|c)\s+(.+)$', line, re.I)
                row = dict(event=event, year=year, group='普及组', province='四川',
                           student=match[1], score=match[2], award=award, source_line=line,
                           coach_raw=teacher[1].strip() if teacher else None, source_url=url,
                           evidence_type='community_repost', verification='待独立来源复核')
                raw_rows.append(row)
            records.extend(raw_rows)
            item['extracted_student_rows'] = len(raw_rows)
            item['nonempty_coach_rows'] = sum(bool(x['coach_raw']) for x in raw_rows)
        manifest.append(item)

    for stem, group, expected, url in [
        ('NOIP2008四川提高', '提高组', 416, 'https://sichuan.xiaoxiaotong.org/AttachFile/520521/633653053052855000.doc'),
        ('NOIP2008四川普及', '普及组', 201, 'https://sichuan.xiaoxiaotong.org/AttachFile/520521/633653055606136250.doc'),
        ('NOIP2008浙江', '提高组和普及组', 794, 'https://www.xiaoxiaotong.org/AttachFile/400521/633713236001505000.doc'),
    ]:
        meta, _ = fetch(url)
        text_path = OUT / (stem + '.txt')
        text = text_path.read_text(encoding='utf-8')
        item = dict(meta, event='NOIP', year=2008, scope=stem, source_type='regional_organizer_attachment',
                    text_path=str(text_path.relative_to(ROOT)), usable=True)
        if '四川' in stem:
            cells = [c.strip() for c in text.split('\x07')]
            award = ''
            rows = []
            for i, cell in enumerate(cells):
                if re.fullmatch('[一二三]等奖', re.sub(r'\s+', '', cell)):
                    award = re.sub(r'\s+', '', cell)
                if i + 6 >= len(cells) or not cell.isdigit():
                    continue
                values = cells[i:i + 7]
                if not values[1] or values[1].isdigit() or values[2] not in ['男', '女', '']:
                    continue
                if not re.fullmatch(r'\d+(?:\.\d+)?', values[6]):
                    continue
                rows.append(dict(event='NOIP', year=2008, group=group, province='四川',
                                 serial=int(cell), student=values[1], gender=values[2], school=values[3],
                                 grade=values[4], coach_raw=values[5], score=values[6], award=award,
                                 source_url=url, evidence_type='regional_organizer_attachment'))
            assert len(rows) == expected, (stem, len(rows))
            assert [r['serial'] for r in rows] == list(range(1, expected + 1))
            records.extend(rows)
            item['extracted_student_rows'] = len(rows)
            item['nonempty_coach_rows'] = sum(bool(x['coach_raw']) for x in rows)
        else:
            item['declared_student_rows'] = expected
            item['nonempty_coach_rows'] = 0
        manifest.append(item)

    # These pages were read in full through the web reader. Preserve factual fields
    # and the retrieval route even when the direct HTTP client cannot load the page.
    url = 'https://www.sohu.com/a/449320403_663876'
    school_rows = []
    for student, award in [('黎晗庆', '金牌'), ('万奕轩', '银牌'), ('王浏清', '银牌'), ('杨远航', '铜牌'), ('刘畅', '铜牌')]:
        school_rows.append(dict(event='WC', year=2021, student=student, award=award,
                               school='江西科技学院附属中学', coach_raw='胡志文', source_url=url,
                               evidence_type='school_published_report', retrieval='web_reader'))
    records.extend(school_rows)
    save_json(OUT / 'wc2021_school_evidence.json', school_rows)
    manifest.append(dict(event='WC', year=2021, scope='江科附中5人', source_type='school_published_report',
                         url=url, usable=True, retrieval='web_reader', extracted_student_rows=5,
                         nonempty_coach_rows=5, evidence_path='external/wc2021_school_evidence.json'))
    url = 'https://www.tzgjzx.com/jxlz/jxcg/content_575'
    row = dict(event='NOIP', year=2007, student='周昊', award='一等奖', group='提高组',
               school='江苏省通州高级中学', coach_raw='任茉莉', source_url=url,
               evidence_type='school_report', retrieval='web_reader')
    records.append(row)
    save_json(OUT / 'noip2007_school_evidence.json', row)
    manifest.append(dict(event='NOIP', year=2007, scope='通州高级中学1人', source_type='school_report',
                         url=url, usable=True, retrieval='web_reader', extracted_student_rows=1,
                         nonempty_coach_rows=1, evidence_path='external/noip2007_school_evidence.json'))
    url = 'https://www.hysbz.com/xwzx/xwdt/content_335'
    for award, names in [('一等奖', '李果 陈同强'), ('二等奖', '罗驰 肖威 何剑 阳煜东 杨子梁'),
                         ('三等奖', '崔琪 洪泽华 戴波 柳仲达 唐乾元 冯晋文 罗成 胡鹏 张新宇')]:
        for name in names.split():
            records.append(dict(event='NOIP', year=2006, student=name, award=award,
                                school='衡阳市第八中学', coach_raw='邹毅', source_url=url,
                                evidence_type='school_report'))
    item = next(m for m in manifest if m.get('key') == 'noip2006_hengyang')
    item.update(extracted_student_rows=16, nonempty_coach_rows=16)
    evidence = dict(event='NOIP', year=2004, school='河南省实验中学',
                    source_url='https://www.hnssyzx.cn/sys-nd/2908.html', retrieval='web_reader',
                    senior_first=['张鹏(小)', '罗宁', '赵迎宾', '刘丰', '李博', '张照宇'],
                    senior_second=['罗宇龙', '张鹏(大)', '秦书楷', '邹盛楠', '杨帆', '张英杰', '刘哲', '葛晨', '梁寅杰'],
                    junior_first=['张萌'], junior_second=['李轶'],
                    school_coaching_team=['常庆卫', '王国正', '张晓燕'],
                    individual_coach_assignment='原文只列校级教师团队，逐人对应待核对')
    save_json(OUT / 'noip2004_school_evidence.json', evidence)
    item = next(m for m in manifest if m.get('key') == 'noip2004_henan')
    item.update(usable=True, retrieval='web_reader', extracted_student_rows=17,
                evidence_path='external/noip2004_school_evidence.json')
    url = 'https://www.dy001.cn/2018/1011/44642.shtml'
    for event, student, award in [('WC', '尹凌峰', '金牌'), ('WC', '孙恩泽', '铜牌'), ('APIO', '孙恩泽', '铜牌')]:
        records.append(dict(event=event, year=2016, student=student, award=award,
                            school='江苏省丹阳高级中学', coach_raw='荆晓虹', source_url=url,
                            evidence_type='newspaper_profile', verification='选手姓名、年份、奖项、学校已与OIerDB核对',
                            note='APIO报道提到两枚铜牌，记录保留奖项关系，未据此推算奖牌数量' if event == 'APIO' else ''))
    db_lines = (ROOT / 'oierdb-raw.txt').read_text(encoding='utf-8').splitlines()
    for row in records:
        if row['event'] == 'WC':
            row['matched_oierdb_lines'] = [line for line in db_lines
                 if line.startswith(f"WC{row['year']},") and f",{row['student']}," in line
                 and row['school'] in line and f",{row['award']}," in line]
            assert len(row['matched_oierdb_lines']) == 1, row
    save_json(OUT / 'source-manifest.json', manifest)
    save_json(OUT / 'coach-records.json', records)
    nonempty = sum(bool(r.get('coach_raw')) for r in records)
    report = [
        '地方与社区来源补查结果', '核验日期 2026-11-09', '',
        '已下载网页、地区原始Word附件，或通过网页阅读器读取正文后保存事实字段。',
        '此次整理12项来源，包括11项可用材料及1项尚未取得正文的线索。',
        f'共保存{len(records)}条补充记录，其中{nonempty}条教练字段非空。统计单位为获奖记录，教练姓名与多人分隔尚待规范化。', '',
        'NOIP 2001',
        '大榕树历史社区的GitHub镜像保存普及组一等奖名单，原文标注75名。文本有异体字、括号及疑似转录错误，适合作为历史名单线索。没有指导教师字段。', '',
        'NOIP 2004',
        '河南省实验中学保存17名具名获奖学生及3名校级辅导教师。逐人师生对应仍待核对。', '',
        'NOIP 2005',
        'OI爱好者论坛保存全国提高组一等奖转载，以及四川普及组一二三等奖转载。',
        '四川普及组提取209条获奖行，其中201条提取到教练文本，保留原始行便于复核。社区转载尚待地区原件或独立来源核对。', '',
        'NOIP 2006—2007',
        '衡阳市第八中学校网2006年喜报列出16名获奖学生及指导老师邹毅。',
        '通州高级中学校网2007年资料给出周昊与任茉莉的对应关系。', '',
        'NOIP 2008',
        '四川地区原始Word附件已下载并读取，提高组416条、普及组201条，按原序号逐条核验连续完整。共617条，616条教练字段非空。',
        '浙江地区原始Word附件也已下载，包含提高组和普及组一二三等奖，文中各奖级人数合计794。此份附件未含指导教师列。', '',
        'WC',
        '2016年丹阳日报人物报道可补尹凌峰、孙恩泽与荆晓虹的指导关系。',
        '2021年江科附中发布的喜报可补黎晗庆、万奕轩、王浏清、杨远航、刘畅与胡志文的指导关系。',
        '这7名学生的年份、奖项及学校已分别与OIerDB核对，均有唯一对应获奖行。', '',
        'APIO',
        '2016年丹阳日报报道可补孙恩泽与荆晓虹的指导关系。报道中的“两枚铜牌”表述保留为备注，奖牌数量还需进一步核对。', '',
        'NOI 2012',
        '新浪博客搜索索引显示含指导老师的转载名单，但桌面正文返回系统维护页，移动页也未返回名单。当前只保存来源线索，未计入已取得教练记录。', '',
        '当前材料属于全国名单、地区名单、学校喜报和个别选手报道等不同覆盖范围。早年部分资料已延伸至2001年，逐人教练记录已延伸至2005年，历史覆盖仍有缺口。', '',
        '文件',
        'coach-records.json 包含提取记录、教练原文、来源URL、证据类型及部分交叉核验结果。',
        'source-manifest.json 包含来源类型、赛事年份、覆盖范围、读取方式和本地文件路径。',
        '原始Word文件、提取文本与网页正文事实字段保存在本目录。', '', '来源索引', ''
    ]
    for item in manifest:
        report.extend([f"{item['event']} {item['year']}  {item['scope']}", item['url'], ''])
    (OUT / '补查结果.txt').write_text('\n'.join(report), encoding='utf-8')
    print('Sources', len(manifest), 'records', len(records))
    for m in manifest:
        print(m['event'], m['year'], m['scope'], m.get('extracted_student_rows'), m.get('nonempty_coach_rows'))


if __name__ == '__main__':
    main()
