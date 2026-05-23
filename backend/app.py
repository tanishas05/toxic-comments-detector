from fastapi import FastAPI
from pydantic import BaseModel
import joblib
from fastapi.middleware.cors import CORSMiddleware
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
model = joblib.load("model.pkl")

class Comment(BaseModel):
    text: str

@app.post("/predict")
def predict(comment: Comment):

    prediction = model.predict([comment.text])[0]
    probability = model.predict_proba([comment.text])[0][1]

    return {
        "toxic": bool(prediction),
        "confidence": round(float(probability), 2)
    }
