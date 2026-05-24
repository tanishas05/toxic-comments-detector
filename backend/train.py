import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.svm import LinearSVC
from sklearn.pipeline import Pipeline
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import accuracy_score, classification_report
import joblib

# ── Load English ──────────────────────────────────────────────────────────────
english = pd.read_csv("data/train.csv")[["comment_text", "toxic"]].dropna()

# ── Load Hinglish ─────────────────────────────────────────────────────────────
hinglish = pd.read_csv("data/combined_hate_speech_dataset.csv")
hinglish = hinglish[["text", "hate_label"]].dropna()
hinglish = hinglish.rename(columns={"text": "comment_text", "hate_label": "toxic"})

# ── Combine ───────────────────────────────────────────────────────────────────
df = pd.concat([english, hinglish], ignore_index=True)

# ── Clean ─────────────────────────────────────────────────────────────────────
df = df.drop_duplicates(subset="comment_text")
df = df[df["comment_text"].str.split().str.len() >= 3]

# fix imbalance — keep all toxic, cap safe to 3x toxic count
toxic_df = df[df["toxic"] == 1]
safe_df = df[df["toxic"] == 0].sample(n=len(toxic_df) * 3, random_state=42)
df = pd.concat([toxic_df, safe_df]).sample(frac=1, random_state=42)

print(f"Toxic: {len(toxic_df)} | Safe: {len(safe_df)} | Total: {len(df)}")

# ── Split ─────────────────────────────────────────────────────────────────────
X_train, X_test, y_train, y_test = train_test_split(
    df["comment_text"], df["toxic"], test_size=0.2, random_state=42
)

# ── Model ─────────────────────────────────────────────────────────────────────
model = Pipeline([
    ("tfidf", TfidfVectorizer(
        stop_words=None,
        analyzer="char_wb",
        ngram_range=(2, 5),
        max_features=50000,
        sublinear_tf=True,
    )),
    ("clf", CalibratedClassifierCV(
        LinearSVC(max_iter=2000, class_weight="balanced")
    ))
])

# ── Train ─────────────────────────────────────────────────────────────────────
print("Training... (2-3 minutes)")
model.fit(X_train, y_train)

# ── Evaluate ──────────────────────────────────────────────────────────────────
preds = model.predict(X_test)
print(f"\nAccuracy: {accuracy_score(y_test, preds):.4f}")
print(classification_report(y_test, preds, target_names=["Safe", "Toxic"]))

# ── Save ──────────────────────────────────────────────────────────────────────
joblib.dump(model, "model.pkl")
print("Saved model.pkl")