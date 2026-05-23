import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import accuracy_score
import joblib

# Load dataset
df = pd.read_csv("data/train.csv")

# Keep only needed columns
df = df[["comment_text", "toxic"]]

# Inputs and labels
X = df["comment_text"]
y = df["toxic"]

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42
)

# Create ML pipeline
model = Pipeline([
    ("tfidf", TfidfVectorizer(stop_words="english")),
    ("clf", LogisticRegression(max_iter=1000))
])

# Train model
model.fit(X_train, y_train)

# Test accuracy
preds = model.predict(X_test)
accuracy = accuracy_score(y_test, preds)

print(f"Accuracy: {accuracy}")

# Save model
joblib.dump(model, "model.pkl")

print("Model saved as model.pkl")