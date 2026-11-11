"""Backfill omitted NOI summer/D-category evidence while preserving audit metadata."""
import json
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from collect_sources import ROOT, classify, fetch, inspect_document, save_json


def main():
    documents = json.loads((ROOT / 'documents.json').read_text(encoding='utf-8'))
    known = {(doc['event'], doc['year'], doc['url']) for doc in documents}
    tasks = []
    # Revisit already collected NOI announcements to discover skipped attachments.
    for doc in documents:
        if doc['event'] == 'NOI' and doc['depth'] < 2:
            tasks.append(('NOI', doc['year'], doc['title'], doc['url'], doc.get('parent_url', ''), doc['depth']))
    # Also discover summer-only announcements omitted by the original title filter.
    for catalog in json.loads((ROOT / 'catalogs.json').read_text(encoding='utf-8')):
        _, content = fetch(catalog['url'])
        for link in BeautifulSoup(content, 'html.parser').select('a[href]'):
            title = link.get_text(' ', strip=True)
            event_year = classify(title)
            href = urljoin(catalog['url'], link['href']).split('#')[0]
            if event_year and event_year[0] == 'NOI' and '/hjmd/mdgs/' in href and href.endswith('.shtml'):
                tasks.append((*event_year, title, href, '', 0))
    visited = set()
    added = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        while tasks:
            batch = []
            for task in tasks:
                key = task[0], task[1], task[3]
                if key not in visited:
                    batch.append(task)
                    visited.add(key)
            tasks = []
            for doc, children in pool.map(inspect_document, batch):
                key = doc['event'], doc['year'], doc['url']
                if key not in known:
                    documents.append(doc)
                    added.append(doc)
                    known.add(key)
                tasks.extend(children)
            print(f'Inspected {len(visited)} documents, added {len(added)}', flush=True)
    save_json(ROOT / 'documents.json', documents)
    save_json(ROOT / 'noi-supplementary-backfill.json', added)
    print(f'Added {len(added)} documents, {sum(d.get("has_coach_column", False) for d in added)} with coach columns', flush=True)


if __name__ == '__main__':
    main()
