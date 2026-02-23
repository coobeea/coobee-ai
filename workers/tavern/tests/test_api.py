"""
Tavern Worker API 测试
"""

import sys
import os
import tempfile
import shutil
import json
from pathlib import Path

# 添加项目根路径以便导入
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root / 'workers' / 'tavern'))

# 测试前设置环境变量
test_dir = tempfile.mkdtemp()
os.environ['USER_HOME'] = test_dir

# 导入 server 模块
from server import (
    read_tasks_index,
    read_task_meta,
    write_task_meta,
    write_tasks_index,
    get_tavern_dir
)


def setup_test_data():
    """准备测试数据"""
    tavern_dir = get_tavern_dir()
    tavern_dir.mkdir(parents=True, exist_ok=True)
    
    # 创建测试任务
    task1 = {
        "id": "task_001",
        "title": "测试任务 1",
        "description": "这是一个测试任务",
        "amount": 100,
        "files": [],
        "status": "pending",
        "createdAt": "2026-02-23T10:00:00Z",
        "updatedAt": "2026-02-23T10:00:00Z"
    }
    
    task2 = {
        "id": "task_002",
        "title": "测试任务 2",
        "description": "另一个测试任务",
        "amount": 200,
        "files": [],
        "status": "accepted",
        "createdAt": "2026-02-23T11:00:00Z",
        "updatedAt": "2026-02-23T11:00:00Z"
    }
    
    # 写入任务元数据
    write_task_meta("task_001", task1)
    write_task_meta("task_002", task2)
    
    # 写入索引
    write_tasks_index([task1, task2])


def test_read_tasks_index():
    """测试读取任务索引"""
    print("测试：读取任务索引...")
    
    tasks = read_tasks_index()
    assert len(tasks) == 2, f"Expected 2 tasks, got {len(tasks)}"
    assert tasks[0]['id'] == 'task_001'
    assert tasks[1]['id'] == 'task_002'
    
    print("✓ 读取任务索引成功")


def test_read_task_meta():
    """测试读取任务元数据"""
    print("测试：读取任务元数据...")
    
    task = read_task_meta("task_001")
    assert task is not None, "Task should exist"
    assert task['title'] == '测试任务 1'
    assert task['status'] == 'pending'
    
    # 测试不存在的任务
    task = read_task_meta("task_999")
    assert task is None, "Non-existent task should return None"
    
    print("✓ 读取任务元数据成功")


def test_update_task():
    """测试更新任务"""
    print("测试：更新任务...")
    
    # 读取任务
    task = read_task_meta("task_001")
    assert task is not None
    
    # 更新状态
    task['status'] = 'accepted'
    task['acceptedBy'] = 'test-agent'
    write_task_meta("task_001", task)
    
    # 验证更新
    updated_task = read_task_meta("task_001")
    assert updated_task['status'] == 'accepted'
    assert updated_task['acceptedBy'] == 'test-agent'
    
    print("✓ 更新任务成功")


def cleanup():
    """清理测试数据"""
    if os.path.exists(test_dir):
        shutil.rmtree(test_dir)
    print("✓ 清理测试数据")


if __name__ == '__main__':
    try:
        setup_test_data()
        test_read_tasks_index()
        test_read_task_meta()
        test_update_task()
        
        print("\n✅ 所有测试通过")
    except AssertionError as e:
        print(f"\n❌ 测试失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 测试出错: {e}")
        sys.exit(1)
    finally:
        cleanup()
