import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { EmployeeStore, type DigitalEmployee } from '@main/ai/employee/EmployeeStore';

const log = createLogger('gateway-http-employee');

export function registerEmployeeRoutes(router: Router): void {
  // 获取员工列表
  router.get('/employee/list', async (ctx) => {
    try {
      const store = await EmployeeStore.getInstance();
      const employees = await store.listEmployees();
      ctx.body = { success: true, data: employees };
    } catch (err) {
      log.error('Failed to list employees:', err);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Failed to list employees' };
    }
  });

  // 获取员工详情
  router.get('/employee/:id', async (ctx) => {
    const id = ctx.params.id;
    if (!id) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Employee ID is required' };
      return;
    }

    try {
      const store = await EmployeeStore.getInstance();
      const employee = await store.getEmployee(id);
      if (!employee) {
        ctx.status = 404;
        ctx.body = { success: false, error: 'Employee not found' };
        return;
      }
      ctx.body = { success: true, data: employee };
    } catch (err) {
      log.error(`Failed to get employee ${id}:`, err);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Failed to get employee' };
    }
  });

  // 创建员工
  router.post('/employee', async (ctx) => {
    try {
      const body = ctx.request.body as Omit<DigitalEmployee, 'id' | 'createdAt' | 'updatedAt'>;

      if (!body.name) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Employee name is required' };
        return;
      }

      const store = await EmployeeStore.getInstance();
      const employee = await store.createEmployee(body);

      log.info(`Employee created: ${employee.id}`);
      ctx.body = { success: true, data: employee };
    } catch (err) {
      log.error('Failed to create employee:', err);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Failed to create employee' };
    }
  });

  // 更新员工
  router.patch('/employee/:id', async (ctx) => {
    const id = ctx.params.id;
    if (!id) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Employee ID is required' };
      return;
    }

    try {
      const body = ctx.request.body as Partial<Omit<DigitalEmployee, 'id' | 'createdAt'>>;
      const store = await EmployeeStore.getInstance();

      const updated = await store.updateEmployee(id, body);

      log.info(`Employee updated: ${id}`);
      ctx.body = { success: true, data: updated };
    } catch (err) {
      log.error(`Failed to update employee ${id}:`, err);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Failed to update employee' };
    }
  });

  // 删除员工
  router.delete('/employee/:id', async (ctx) => {
    const id = ctx.params.id;
    if (!id) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Employee ID is required' };
      return;
    }

    try {
      const store = await EmployeeStore.getInstance();
      await store.deleteEmployee(id);

      log.info(`Employee deleted: ${id}`);
      ctx.body = { success: true };
    } catch (err) {
      log.error(`Failed to delete employee ${id}:`, err);
      ctx.status = 500;
      ctx.body = { success: false, error: 'Failed to delete employee' };
    }
  });
}
