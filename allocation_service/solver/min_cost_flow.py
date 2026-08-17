from __future__ import annotations

from dataclasses import dataclass
import heapq
from math import inf


@dataclass
class Edge:
    to: int
    reverse: int
    capacity: int
    cost: int
    original_capacity: int


class MinCostMaxFlow:
    def __init__(self, node_count: int) -> None:
        self.graph: list[list[Edge]] = [[] for _ in range(node_count)]

    def add_edge(self, source: int, target: int, capacity: int, cost: int) -> int:
        if capacity < 0:
            raise ValueError("流网络边容量不能为负数")
        if cost < 0:
            raise ValueError("流网络边费用不能为负数")
        forward_index = len(self.graph[source])
        reverse_index = len(self.graph[target])
        self.graph[source].append(Edge(target, reverse_index, capacity, cost, capacity))
        self.graph[target].append(Edge(source, forward_index, 0, -cost, 0))
        return forward_index

    def min_cost_max_flow(self, source: int, sink: int, demand: int) -> tuple[int, int]:
        node_count = len(self.graph)
        potential = [0] * node_count
        flow = 0
        total_cost = 0

        while flow < demand:
            distance = [inf] * node_count
            previous_node = [-1] * node_count
            previous_edge = [-1] * node_count
            distance[source] = 0
            queue: list[tuple[int, int]] = [(0, source)]

            while queue:
                current_distance, node = heapq.heappop(queue)
                if current_distance != distance[node]:
                    continue
                for edge_index, edge in enumerate(self.graph[node]):
                    if edge.capacity <= 0:
                        continue
                    next_distance = current_distance + edge.cost + potential[node] - potential[edge.to]
                    if next_distance >= distance[edge.to]:
                        continue
                    distance[edge.to] = next_distance
                    previous_node[edge.to] = node
                    previous_edge[edge.to] = edge_index
                    heapq.heappush(queue, (next_distance, edge.to))

            if distance[sink] == inf:
                break

            for node, node_distance in enumerate(distance):
                if node_distance < inf:
                    potential[node] += int(node_distance)

            augment = demand - flow
            node = sink
            while node != source:
                parent = previous_node[node]
                edge = self.graph[parent][previous_edge[node]]
                augment = min(augment, edge.capacity)
                node = parent

            node = sink
            while node != source:
                parent = previous_node[node]
                edge = self.graph[parent][previous_edge[node]]
                edge.capacity -= augment
                self.graph[node][edge.reverse].capacity += augment
                total_cost += augment * edge.cost
                node = parent
            flow += augment

        return flow, total_cost
