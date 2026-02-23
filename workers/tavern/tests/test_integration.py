"""
Tavern Worker 集成测试

测试完整的 HTTP API 功能
"""

import sys
import os
import tempfile
import shutil
import json
import time
import subprocess
import signal
from pathlib import Path

# 测试配置
TEST_PORT = 19010  # 使用不同的端口避免冲突
WORKER_URL = f"http://localhost:{TEST_PORT}"

# 设置测试环境
test_dir = tempfile.mkdtemp()
os.environ['USER_HOME'] = test_dir

# Worker 进程
worker_process = None


def start_worker():
    """启动 Worker 进程"""
    global worker_process
    
    print(f"启动 Tavern Worker (端口 {TEST_PORT})...")
    
    # 获取 worker 目录
    worker_dir = Path(__file__).parent.parent
    server_path = worker_dir / 'server.py'
    
    # 先安装依赖（如果需要）
    requirements_path = worker_dir / 'requirements.txt'
    if requirements_path.exists():
        print("安装 Python 依赖...")
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '-q', '-r', str(requirements_path)],
            capture_output=True
        )
        if result.returncode != 0:
            print(f"⚠️  依赖安装失败: {result.stderr.decode()}")
    
    worker_process = subprocess.Popen(
        [sys.executable, str(server_path), '--port', str(TEST_PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=os.environ
    )
    
    # 等待 Worker 启动
    max_attempts = 30
    for i in range(max_attempts):
        try:
            result = subprocess.run(
                ['curl', '-s', f'{WORKER_URL}/health'],
                capture_output=True,
                timeout=1
            )
            if result.returncode == 0:
                response = json.loads(result.stdout)
                if response.get('status') == 'ok':
                    print(f"✓ Worker 启动成功 (尝试 {i+1}/{max_attempts})")
                    return True
        except:
            pass
        time.sleep(0.5)
    
    print(f"✗ Worker 启动失败")
    return False


def stop_worker():
    """停止 Worker 进程"""
    global worker_process
    
    if worker_process:
        print("停止 Tavern Worker...")
        worker_process.send_signal(signal.SIGTERM)
        worker_process.wait(timeout=5)
        worker_process = None


def api_call(method, endpoint, data=None):
    """调用 API"""
    url = f"{WORKER_URL}{endpoint}"
    
    cmd = ['curl', '-s', '-X', method, url, '-H', 'Content-Type: application/json']
    
    if data:
        cmd.extend(['-d', json.dumps(data)])
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    try:
        return json.loads(result.stdout)
    except:
        print(f"API 调用失败: {result.stdout}")
        return None


def test_health_check():
    """测试健康检查"""
    print("\n测试：健康检查...")
    
    response = api_call('GET', '/health')
    assert response is not None, "健康检查无响应"
    assert response.get('status') == 'ok', f"健康检查失败: {response}"
    
    print("✓ 健康检查通过")


def test_list_tasks_empty():
    """测试空任务列表"""
    print("\n测试：空任务列表...")
    
    response = api_call('GET', '/api/tavern/tasks')
    assert response is not None, "API 无响应"
    assert response.get('ok') == True, f"API 返回错误: {response}"
    
    data = response.get('data', {})
    assert data.get('total') == 0, f"应该是空列表，实际有 {data.get('total')} 个任务"
    
    print("✓ 空任务列表测试通过")


def test_create_and_query_task():
    """测试创建和查询任务（通过文件系统直接创建）"""
    print("\n测试：创建和查询任务...")
    
    # 直接写入任务到文件系统
    tavern_dir = Path(test_dir) / 'tavern'
    tavern_dir.mkdir(parents=True, exist_ok=True)
    
    task = {
        "id": "test_task_001",
        "title": "测试任务",
        "description": "这是一个测试任务",
        "amount": 100,
        "files": [],
        "status": "pending",
        "createdAt": "2026-02-23T10:00:00Z",
        "updatedAt": "2026-02-23T10:00:00Z"
    }
    
    # 写入任务元数据
    task_dir = tavern_dir / 'tasks' / task['id']
    task_dir.mkdir(parents=True, exist_ok=True)
    with open(task_dir / 'meta.json', 'w', encoding='utf-8') as f:
        json.dump(task, f, ensure_ascii=False, indent=2)
    
    # 写入索引
    with open(tavern_dir / 'tasks.jsonl', 'w', encoding='utf-8') as f:
        f.write(json.dumps(task, ensure_ascii=False) + '\n')
    
    # 查询任务列表
    response = api_call('GET', '/api/tavern/tasks')
    assert response.get('ok') == True, f"查询失败: {response}"
    
    data = response.get('data', {})
    tasks = data.get('tasks', [])
    assert len(tasks) == 1, f"应该有 1 个任务，实际有 {len(tasks)} 个"
    assert tasks[0]['id'] == 'test_task_001'
    
    print("✓ 创建和查询任务通过")


def test_get_task_detail():
    """测试获取任务详情"""
    print("\n测试：获取任务详情...")
    
    response = api_call('GET', '/api/tavern/tasks/test_task_001')
    assert response.get('ok') == True, f"获取详情失败: {response}"
    
    task = response.get('data', {})
    assert task.get('id') == 'test_task_001'
    assert task.get('title') == '测试任务'
    assert task.get('status') == 'pending'
    
    print("✓ 获取任务详情通过")


def test_accept_task():
    """测试接取任务"""
    print("\n测试：接取任务...")
    
    response = api_call('POST', '/api/tavern/tasks/test_task_001/accept', {
        "agent_id": "test-agent"
    })
    
    assert response.get('ok') == True, f"接取任务失败: {response}"
    
    task = response.get('data', {})
    assert task.get('status') == 'accepted', f"状态应为 accepted，实际为 {task.get('status')}"
    assert task.get('acceptedBy') == 'test-agent'
    
    print("✓ 接取任务通过")


def test_submit_result():
    """测试提交结果"""
    print("\n测试：提交结果...")
    
    response = api_call('POST', '/api/tavern/tasks/test_task_001/result', {
        "textResult": "任务完成",
        "fileResults": ["/path/to/output.txt"]
    })
    
    assert response.get('ok') == True, f"提交结果失败: {response}"
    
    task = response.get('data', {})
    assert task.get('status') == 'completed', f"状态应为 completed，实际为 {task.get('status')}"
    assert task.get('result', {}).get('textResult') == '任务完成'
    
    print("✓ 提交结果通过")


def test_stats():
    """测试统计信息"""
    print("\n测试：统计信息...")
    
    response = api_call('GET', '/api/tavern/stats')
    assert response.get('ok') == True, f"获取统计失败: {response}"
    
    stats = response.get('data', {})
    assert stats.get('total') == 1
    assert stats.get('byStatus', {}).get('completed') == 1
    
    print("✓ 统计信息通过")


def test_query_by_status():
    """测试按状态查询"""
    print("\n测试：按状态查询...")
    
    # 查询 pending 任务（应该为 0，因为已接取并完成）
    response = api_call('GET', '/api/tavern/tasks?status=pending')
    assert response.get('ok') == True
    assert response.get('data', {}).get('total') == 0
    
    # 查询 completed 任务
    response = api_call('GET', '/api/tavern/tasks?status=completed')
    assert response.get('ok') == True
    assert response.get('data', {}).get('total') == 1
    
    print("✓ 按状态查询通过")


def cleanup():
    """清理测试数据"""
    if os.path.exists(test_dir):
        shutil.rmtree(test_dir)
    print("\n✓ 清理测试数据")


if __name__ == '__main__':
    try:
        # 启动 Worker
        if not start_worker():
            print("❌ Worker 启动失败")
            sys.exit(1)
        
        # 运行测试
        test_health_check()
        test_list_tasks_empty()
        test_create_and_query_task()
        test_get_task_detail()
        test_accept_task()
        test_submit_result()
        test_stats()
        test_query_by_status()
        
        print("\n" + "="*60)
        print("✅ 所有集成测试通过")
        print("="*60)
        
    except AssertionError as e:
        print(f"\n❌ 测试失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 测试出错: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        stop_worker()
        cleanup()
