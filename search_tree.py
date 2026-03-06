import urllib.request, json
url = 'https://api.github.com/search/code?q=filename:tree.glb+size:>2000000'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        for item in data.get('items', [])[:5]:
            raw_url = item['html_url'].replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
            print(f"{item['repository']['full_name']} -> {raw_url}")
except Exception as e:
    print('Error:', e)
