Wordikt is a real-time comment toxicity detection tool built with a machine learning pipeline trained on 160,000+ English and Hinglish comments.

## Features

- **Live detection** — classifies comments after each word as you type
- **4 toxicity levels** — Safe, Mildly Toxic, Toxic, Extremely Toxic
- **Harmful word highlighting** — flags toxic keywords inline in red
- **Bulk upload** — upload `.txt`, `.csv`, or `.pdf` files and analyze hundreds of comments at once with pause/resume/cancel
- **Export results** — download bulk analysis as a CSV file
- **Dashboard** — session statistics, level breakdown, most flagged terms, comment log
- **Bilingual** — trained on English + Hinglish (Hindi-English code-mixed) data
- **Mobile responsive** — works on phone with hamburger navigation

## Tech Stack

Frontend - React 19, Vite, Axios 
Backend - FastAPI, Python 3.11 
ML Model - scikit-learn — TF-IDF (char n-grams) + LinearSVC 
PDF parsing - pdfjs-dist 
Deployment - Vercel (frontend), HuggingFace Spaces (backend) 

## Model Details

- **Algorithm:** LinearSVC wrapped in CalibratedClassifierCV
- **Vectorizer:** TF-IDF with `analyzer="char_wb"`, `ngram_range=(2,5)` — handles transliteration variants in Hinglish
- **Training data:** Jigsaw Toxic Comment dataset (English) + combined Hinglish hate speech dataset
- **Dataset size:** ~115,000 comments after cleaning
- **Accuracy:** 89.5%
- **Precision (Toxic):** 0.82
- **Recall (Toxic):** 0.75

## Deployment

- **Frontend** — push to GitHub, Vercel auto-deploys
- **Backend** — hosted on HuggingFace Spaces (Docker), no sleep on free tier

To update the backend:

bash
cd wordikt-backend   # your HF Space clone
export PATH=$HOME/bin:$PATH
cp ../toxic-comments-detector/backend/app.py .
git add . && git commit -m "update" && git push

## Limitations

- Highlighting is regex-based, not ML-based — the model may flag a comment as toxic without any highlighted words (tone-based detection)
- Sarcasm and irony can fool the model
- Primarily trained on English; Hinglish accuracy improves with more labeled data
- Free HuggingFace tier has shared CPU — expect 1–3s response time

## Dataset Sources

- [Jigsaw Toxic Comment Classification Challenge](https://www.kaggle.com/c/jigsaw-toxic-comment-classification-challenge)
- Combined Hinglish hate speech dataset (Kaggle)

## Author

**Tanisha Sharma**
- GitHub: [github.com/tanishas05](https://github.com/tanishas05)
- LinkedIn: [linkedin.com/in/tanishas05](https://www.linkedin.com/in/tanishas05/)
