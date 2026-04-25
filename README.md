# CMA-ES-ALGORITHM

Bu repo, CMA-ES tabanli optimizasyon calismalari ve Flask arayuzu ile
"ogrenen ucak" demosunu icerir.

## Icerik

- `final_sunum/final_notebook.ipynb`: ana notebook
- `final_sunum/final_notebook_executed.ipynb`: calistirilmis notebook
- `final_sunum/benchmark_functions.py`: test/benchmark fonksiyonlari
- `final_sunum/web_app/`: Flask tabanli web arayuzu ve statik dosyalar

## Lokal Calistirma

```bash
cd final_sunum/web_app
pip install -r requirements.txt
python app.py
```

Tarayici: `http://127.0.0.1:5000`

## Render Blueprint Deploy

Projede `render.yaml` dosyasi vardir. Render uzerinde
**Blueprint** olustururken bu dosya otomatik algilanir.
