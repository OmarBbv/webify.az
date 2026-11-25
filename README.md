# webify.az SEO jurnalı

Bu branch sayt deyil. Gündəlik SEO agenti (Claude cloud routine) hər səhər buraya yazır:

| Fayl | Nə var |
|---|---|
| `log.md` | Hər günün qeydi: sıra dəyişiklikləri, nə edildi, hansı commit-lər main-ə getdi |
| `latest.md` | Son Search Console hesabatı (izlənən sorğular, fürsətlər, yeni sorğular) |
| `rankings.csv` | Gün × sorğu × səhifə: klik, göstərilmə, CTR, orta mövqe |
| `daily-totals.csv` | Saytın gündəlik ümumi göstəriciləri |

Data Google Search Console-dandır və 2–3 gün gecikmə ilə gəlir. `vercel.json` bu branch-ın Vercel-də deploy olunmasını söndürür.
