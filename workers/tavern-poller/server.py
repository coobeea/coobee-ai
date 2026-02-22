import time
import requests
import json
import argparse
import sys
import os
from datetime import datetime
from fastapi import FastAPI, BackgroundTasks
import uvicorn

app = FastAPI()

def log(level, message):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [{level}] {message}")
    sys.stdout.flush()

# 存储已经推送过的任务 ID
processed_tasks = set()

def poll_tavern_tasks():
    user_home = os.environ.get("USER_HOME")
    if not user_home:
        log("ERROR", "USER_HOME environment variable not set")
        return

    tasks_index_path = os.path.join(user_home, "tavern", "tasks.jsonl")
    
    if not os.path.exists(tasks_index_path):
        log("DEBUG", f"Tasks index file not found: {tasks_index_path}")
        return

    try:
        with open(tasks_index_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            for line in lines:
                if not line.strip():
                    continue
                task = json.loads(line)
                
                task_id = task.get("id")
                status = task.get("status")
                
                if status == "pending" and task_id not in processed_tasks:
                    log("INFO", f"Found new pending task: {task_id}")
                    
                    # 推送给主进程 (假设主进程端口在 VITE_SERVER_PORT，默认为 8765)
                    server_port = os.environ.get("VITE_SERVER_PORT", "8765")
                    # 这里推送到我们要开发的 Phase 3 插件接口
                    # 按照计划是 /internal/tavern/events
                    target_url = f"http://127.0.0.1:{server_port}/internal/tavern/events"
                    
                    try:
                        resp = requests.post(target_url, json={"event": "external.tavern.task.created", "task": task}, timeout=2)
                        if resp.status_code == 200:
                            log("INFO", f"Successfully pushed task {task_id} to main process")
                            processed_tasks.add(task_id)
                        else:
                            log("WARN", f"Failed to push task {task_id}, status: {resp.status_code}")
                    except Exception as e:
                        log("ERROR", f"Error pushing task {task_id}: {str(e)}")
    except Exception as e:
        log("ERROR", f"Error reading tasks index: {str(e)}")

def background_poller():
    log("INFO", "Starting background poller...")
    while True:
        poll_tavern_tasks()
        time.sleep(5)

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.on_event("startup")
def startup_event():
    import threading
    poller_thread = threading.Thread(target=background_poller, daemon=True)
    poller_thread.start()

def main():
    parser = argparse.ArgumentParser(description="Tavern Poller Worker")
    parser.add_argument("--port", type=int, help="Port to run on", default=9010)
    args = parser.parse_args()

    port = args.port
    log("INFO", f"Tavern Poller Worker starting on port {port}")
    
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

if __name__ == "__main__":
    main()
