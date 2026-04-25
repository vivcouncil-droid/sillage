# SILLAGE — AI Perfume Expert

## Struktura projekta
```
sillage/
├── index.html       ← cijela aplikacija
├── api/
│   └── chat.js      ← Vercel serverless proxy (štiti API ključ)
├── vercel.json      ← Vercel konfiguracija
└── README.md
```

## Deploy na Vercel

### 1. GitHub
```bash
git init
git add .
git commit -m "Initial SILLAGE MVP"
git remote add origin https://github.com/TVOJE_IME/sillage.git
git branch -M main
git push -u origin main
```

### 2. Vercel
1. vercel.com → Add New Project → importaj sillage repo
2. Framework: **Other**
3. Environment Variables → dodaj:
   - `ANTHROPIC_API_KEY` = tvoj ključ (sk-ant-...)
4. Deploy

### 3. Namecheap domena (sillage.to)
U Vercel → Settings → Domains → dodaj `sillage.to`

U Namecheap → Advanced DNS:
- Type: `CNAME` | Host: `@` | Value: `cname.vercel-dns.com`
- Type: `CNAME` | Host: `www` | Value: `cname.vercel-dns.com`
