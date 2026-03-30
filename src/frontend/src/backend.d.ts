import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface Task {
    id: bigint;
    name: string;
    priority: bigint;
}
export interface Resource {
    id: bigint;
    name: string;
}
export interface Allocation {
    id: bigint;
    resourceId: bigint;
    taskId: bigint;
}
export interface Request {
    id: bigint;
    resourceId: bigint;
    taskId: bigint;
}
export interface backendInterface {
    createAllocation(resourceId: bigint, taskId: bigint): Promise<Allocation>;
    createRequest(taskId: bigint, resourceId: bigint): Promise<Request>;
    createResource(name: string): Promise<Resource>;
    createTask(name: string, priority: bigint): Promise<Task>;
    deleteAllocation(id: bigint): Promise<void>;
    deleteRequest(id: bigint): Promise<void>;
    deleteResource(id: bigint): Promise<void>;
    deleteTask(id: bigint): Promise<void>;
    getAllAllocations(): Promise<Array<Allocation>>;
    getAllRequests(): Promise<Array<Request>>;
    getAllResources(): Promise<Array<Resource>>;
    getAllTasks(): Promise<Array<Task>>;
    getAllTasksByPriority(): Promise<Array<Task>>;
    getAllocation(id: bigint): Promise<Allocation>;
    getRequest(id: bigint): Promise<Request>;
    getResource(id: bigint): Promise<Resource>;
    getTask(id: bigint): Promise<Task>;
    updateTask(id: bigint, name: string, priority: bigint): Promise<Task>;
}
