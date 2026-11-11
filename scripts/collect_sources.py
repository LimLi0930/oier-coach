"""Download public competition sources and preserve per-document provenance."""
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1] / 'data' / 'source-audit'
RAW = ROOT / 'raw'
TABLES = ROOT / 'tables'
for directory in (RAW, TABLES):
    directory.mkdir(parents=True, exist_ok=True)


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def fetch(url):
    key = hashlib.sha256(url.encode()).hexdigest()[:20]
    path = RAW / key
    meta_path = RAW / (key + '.json')
    if path.exists() and meta_path.exists():
        return json.loads(meta_path.read_text(encoding='utf-8')), path.read_bytes()
    meta = {'url': url, 'fetched_at': datetime.now(timezone.utc).isoformat()}
    try:
        response = requests.get(url, timeout=35)
        meta.update(status=response.status_code, final_url=response.url,
                    content_type=response.headers.get('Content-Type', ''),
                    bytes=len(response.content), raw_path=str(path.relative_to(ROOT)))
        if response.ok:
            path.write_bytes(response.content)
            save_json(meta_path, meta)
            return meta, response.content
    except requests.RequestException as error:
        meta['error'] = str(error)
    return meta, b''


def classify(title):
    if re.search('教学|教师|同步|Online|女生|AI辅助', title, re.I):
        return None
    year = re.search(r'(?:19|20)\d{2}', title)
    if not year:
        return None
    for event, pattern in [('NOIP', 'NOIP'), ('APIO', 'APIO'), ('WC', '冬令营'), ('NOI', 'NOI')]:
        if re.search(pattern, title, re.I):
            return event, int(year.group())
    return None


def extract_tables(soup):
    tables = []
    for table in soup.select('table'):
        # Keep source cells and spans, without inventing normalized records.
        rows = []
        for row in table.find_all('tr'):
            if row.find_parent('table') != table:
                continue
            cells = [{'text': cell.get_text(' ', strip=True),
                      'rowspan': cell.get('rowspan', '1'),
                      'colspan': cell.get('colspan', '1')}
                     for cell in row.find_all(['td', 'th'], recursive=False)]
            if cells:
                rows.append(cells)
        if rows:
            tables.append(rows)
    return tables


def inspect_document(task):
    event, year, title, url, parent, depth = task
    meta, content = fetch(url)
    doc = dict(meta, event=event, year=year, title=title, parent_url=parent, depth=depth)
    children = []
    if not content:
        return doc, children
    if 'ID传入错误'.encode() in content:
        doc['parse_status'] = 'invalid_resource_id'
        return doc, children
    if b'aliyun_waf_aa' in content[:5000]:
        doc['parse_status'] = 'access_challenge'
        return doc, children
    if b'<\x00h\x00t\x00m\x00l\x00' in content[:100]:
        start = content.index(b'<\x00h\x00t\x00m\x00l\x00')
        content = content[start:].decode('utf-16-le', errors='replace').encode('utf-8')
        doc['encoding_repair'] = 'UTF-16LE HTML with damaged BOM'
    if not re.search(br'<(?:html|table|!doctype)', content[:5000], re.I):
        doc['parse_status'] = 'binary_pending'
        return doc, children
    soup = BeautifulSoup(content, 'html.parser')
    body = soup.select_one('.news-cont') or soup
    tables = extract_tables(body)
    name_pattern = r'姓名|选手姓名|Name|Contestant'
    result_tables = [t for t in tables if any(re.fullmatch(name_pattern, re.sub(r'\s+', '', c['text']), re.I)
                                              for row in t[:15] for c in row)]
    coach_tables = [t for t in result_tables if any(re.search(r'指导教[师练]|辅导教[师练]|教练', re.sub(r'\s+', '', c['text']))
                                                    for row in t[:15] for c in row)]
    doc.update(parse_status='html', table_count=len(result_tables),
               has_coach_column=bool(coach_tables),
               table_rows=sum(len(t) for t in result_tables),
               header_samples=[[c['text'] for c in row] for t in result_tables for row in t[:3]])
    if tables:
        table_path = TABLES / (hashlib.sha256(url.encode()).hexdigest()[:20] + '.json')
        save_json(table_path, tables)
        doc['tables_path'] = str(table_path.relative_to(ROOT))
    if depth < 2 and event != 'IOI':
        for link in body.select('a[href]'):
            href = urljoin(url, link['href']).split('#')[0]
            label = link.get('title') or link.get_text(' ', strip=True)
            context = link.find_parent('p')
            if context:
                label = context.get_text(' ', strip=True)
            if re.search('AI辅助', label):
                continue
            if not href.startswith(('http:', 'https:', 'ftp:')) or href == url:
                continue
            if re.search(r'/upload/|/file/|/resource/show|\.(?:htm|html|xls|xlsx|doc|docx|pdf|zip|rar)$', href, re.I):
                children.append((event, year, label or title, href, url, depth + 1))
    return doc, children


def main():
    catalogs = ['https://www.noi.cn/hjmd/mdgs/', 'https://www.noi.cn/hjmd/mdgs/more/']
    seen = set()
    articles = {}
    catalog_log = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        while catalogs:
            batch = [url for url in catalogs if url not in seen]
            seen.update(batch)
            catalogs = []
            for url, (meta, content) in zip(batch, pool.map(fetch, batch)):
                catalog_log.append(meta)
                soup = BeautifulSoup(content, 'html.parser')
                for a in soup.select('a[href]'):
                    href = urljoin(url, a['href']).split('#')[0]
                    title = a.get_text(' ', strip=True)
                    if re.search(r'/hjmd/mdgs/(?:\d{4}/|more/)?(?:index(?:_\d+)?\.shtml)?$', href):
                        if href not in seen:
                            catalogs.append(href)
                    elif '/hjmd/mdgs/' in href and href.endswith('.shtml'):
                        event_year = classify(title)
                        if event_year:
                            articles[href] = (*event_year, title, href, '', 0)
            catalogs = list(dict.fromkeys(catalogs))
        save_json(ROOT / 'catalogs.json', catalog_log)
        save_json(ROOT / 'articles.json', list(articles.values()))
        print(f'Discovered {len(articles)} competition articles from {len(catalog_log)} indexes', flush=True)
        tasks = list(articles.values())
        extra_path = ROOT / 'additional-sources.json'
        if extra_path.exists():
            tasks.extend((*source, 'web_search', 1) for source in json.loads(extra_path.read_text(encoding='utf-8')))
        tasks.extend(('IOI', year, f'IOI {year} results',
                      f'https://stats.ioinformatics.org/results/{year}', '', 0)
                     for year in range(1989, 2027))
        docs = []
        fetched = set()
        while tasks:
            batch = [t for t in tasks if (t[0], t[1], t[3]) not in fetched]
            fetched.update((t[0], t[1], t[3]) for t in batch)
            tasks = []
            for doc, children in pool.map(inspect_document, batch):
                docs.append(doc)
                tasks.extend(children)
            save_json(ROOT / 'documents.json', docs)
            print(f'Inspected {len(docs)} documents, queued {len(tasks)} links', flush=True)
    for name in ['contests.json', 'raw.txt']:
        url = 'https://raw.githubusercontent.com/OIerDb-ng/OIerDb/master/data/' + name
        meta, content = fetch(url)
        if content:
            (ROOT / ('oierdb-' + name)).write_bytes(content)
        save_json(ROOT / ('oierdb-' + name + '.source.json'), meta)
    print('Collection complete', flush=True)


if __name__ == '__main__':
    main()
