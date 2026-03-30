import Text "mo:core/Text";
import Order "mo:core/Order";
import Map "mo:core/Map";
import Iter "mo:core/Iter";
import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Runtime "mo:core/Runtime";

actor {
  type Task = {
    id : Nat;
    name : Text;
    priority : Nat;
  };

  type Resource = {
    id : Nat;
    name : Text;
  };

  type Allocation = {
    id : Nat;
    resourceId : Nat;
    taskId : Nat;
  };

  type Request = {
    id : Nat;
    taskId : Nat;
    resourceId : Nat;
  };

  module Task {
    public func compare(t1 : Task, t2 : Task) : Order.Order {
      Nat.compare(t1.id, t2.id);
    };

    public func compareByPriority(t1 : Task, t2 : Task) : Order.Order {
      Nat.compare(t1.priority, t2.priority);
    };
  };

  module Resource {
    public func compare(r1 : Resource, r2 : Resource) : Order.Order {
      Nat.compare(r1.id, r2.id);
    };
  };

  module Allocation {
    public func compare(a1 : Allocation, a2 : Allocation) : Order.Order {
      Nat.compare(a1.id, a2.id);
    };
  };

  module Request {
    public func compare(r1 : Request, r2 : Request) : Order.Order {
      Nat.compare(r1.id, r2.id);
    };
  };

  var nextTaskId = 0;
  var nextResourceId = 0;
  var nextAllocationId = 0;
  var nextRequestId = 0;

  let tasks = Map.empty<Nat, Task>();
  let resources = Map.empty<Nat, Resource>();
  let allocations = Map.empty<Nat, Allocation>();
  let requests = Map.empty<Nat, Request>();

  func getTaskInternal(id : Nat) : Task {
    switch (tasks.get(id)) {
      case (null) { Runtime.trap("Task not found") };
      case (?task) { task };
    };
  };

  func getResourceInternal(id : Nat) : Resource {
    switch (resources.get(id)) {
      case (null) { Runtime.trap("Resource not found") };
      case (?resource) { resource };
    };
  };

  func getAllocationInternal(id : Nat) : Allocation {
    switch (allocations.get(id)) {
      case (null) { Runtime.trap("Allocation not found") };
      case (?allocation) { allocation };
    };
  };

  func getRequestInternal(id : Nat) : Request {
    switch (requests.get(id)) {
      case (null) { Runtime.trap("Request not found") };
      case (?request) { request };
    };
  };

  public shared ({ caller }) func createTask(name : Text, priority : Nat) : async Task {
    let id = nextTaskId;
    nextTaskId += 1;
    let task : Task = { id; name; priority };
    tasks.add(id, task);
    task;
  };

  public shared ({ caller }) func updateTask(id : Nat, name : Text, priority : Nat) : async Task {
    ignore getTaskInternal(id);
    let task : Task = { id; name; priority };
    tasks.add(id, task);
    task;
  };

  public shared ({ caller }) func deleteTask(id : Nat) : async () {
    if (not tasks.containsKey(id)) { Runtime.trap("Task not found") };
    tasks.remove(id);
  };

  public query ({ caller }) func getTask(id : Nat) : async Task {
    getTaskInternal(id);
  };

  public query ({ caller }) func getAllTasks() : async [Task] {
    tasks.values().toArray().sort();
  };

  public query ({ caller }) func getAllTasksByPriority() : async [Task] {
    tasks.values().toArray().sort(Task.compareByPriority);
  };

  public shared ({ caller }) func createResource(name : Text) : async Resource {
    let id = nextResourceId;
    nextResourceId += 1;
    let resource : Resource = { id; name };
    resources.add(id, resource);
    resource;
  };

  public shared ({ caller }) func deleteResource(id : Nat) : async () {
    if (not resources.containsKey(id)) { Runtime.trap("Resource not found") };
    resources.remove(id);
  };

  public query ({ caller }) func getResource(id : Nat) : async Resource {
    getResourceInternal(id);
  };

  public query ({ caller }) func getAllResources() : async [Resource] {
    resources.values().toArray().sort();
  };

  public shared ({ caller }) func createAllocation(resourceId : Nat, taskId : Nat) : async Allocation {
    ignore getResourceInternal(resourceId);
    ignore getTaskInternal(taskId);

    let id = nextAllocationId;
    nextAllocationId += 1;
    let allocation : Allocation = { id; resourceId; taskId };
    allocations.add(id, allocation);
    allocation;
  };

  public shared ({ caller }) func deleteAllocation(id : Nat) : async () {
    if (not allocations.containsKey(id)) { Runtime.trap("Allocation not found") };
    allocations.remove(id);
  };

  public query ({ caller }) func getAllocation(id : Nat) : async Allocation {
    getAllocationInternal(id);
  };

  public query ({ caller }) func getAllAllocations() : async [Allocation] {
    allocations.values().toArray().sort(Allocation.compare);
  };

  public shared ({ caller }) func createRequest(taskId : Nat, resourceId : Nat) : async Request {
    ignore getTaskInternal(taskId);
    ignore getResourceInternal(resourceId);

    let id = nextRequestId;
    nextRequestId += 1;
    let request : Request = { id; taskId; resourceId };
    requests.add(id, request);
    request;
  };

  public shared ({ caller }) func deleteRequest(id : Nat) : async () {
    if (not requests.containsKey(id)) { Runtime.trap("Request not found") };
    requests.remove(id);
  };

  public query ({ caller }) func getRequest(id : Nat) : async Request {
    getRequestInternal(id);
  };

  public query ({ caller }) func getAllRequests() : async [Request] {
    requests.values().toArray().sort(Request.compare);
  };
};
