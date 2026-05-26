from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import leads, pipeline

app = FastAPI(title="Cosailor Insights API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leads.router, prefix="/api/leads", tags=["leads"])
app.include_router(pipeline.router, prefix="/api/pipeline", tags=["pipeline"])


@app.get("/health")
async def health():
    return {"status": "ok"}
