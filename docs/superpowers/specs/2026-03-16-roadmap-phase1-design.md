# AI Insight — Roadmap Phase 1 设计文档
**日期**：2026-03-16
**关联 Issue**：[#4 Roadmap 讨论](https://github.com/guo-sj/ai-paper-reader/issues/4)
**分支**：`fix/4-roadmap`

---

## 目标

在现有系统基础上实现论文分类筛选与多维度排序，让专家每天能快速找到与自己专题（Attention、MoE、量化等）最相关的 Top 论文，且不遗漏关键论文。

**范围**：Phase 1 MVP，不含回溯窗口、邮件改造、按类别订阅。

---

## 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 类别分类方式 | AI 动态生成（GPT-4o 从预定义列表选标签） | 改动最小，支持细粒度专题（如 Attention、MoE） |
| 量化类别 | 独立一级类别，不归入 Efficient AI | Issue #4 明确将量化列为独立专题 |
| API breaking change | 直接迁移，前后端同步改 | 无外部消费者，干净利落 |
| PaperAnalysis 类型 | 统一到 `types.ts`，服务端 import | 消除重复定义，单一 source of truth |
| 前端筛选/排序 | 前端本地完成 | 响应即时，无网络延迟，切换类别体验流畅 |
| 标签栏类别展示 | 展示全部预定义类别（含空类别） | 让用户了解完整的类别体系 |

---

## 第一节：数据模型

### 1.1 类别配置 `server/categories.json`

```json
{
  "version": 1,
  "scoring": {
    "w_upvotes": 0.3,
    "w_relevance": 0.3,
    "w_category": 0.4
  },
  "categories": [
    { "id": "attention",     "label": "Attention / Transformer", "aliases": ["self-attention", "transformer architecture", "sparse attention", "linear attention"] },
    { "id": "moe",           "label": "MoE (Mixture of Experts)", "aliases": ["mixture of experts", "sparse experts", "expert routing"] },
    { "id": "quantization",  "label": "量化 (Quantization)",      "aliases": ["low-bit", "post-training quantization", "QAT", "int4", "int8", "quantization-aware training"] },
    { "id": "diffusion",     "label": "Diffusion Models",         "aliases": ["denoising diffusion", "score-based", "DDPM", "flow matching"] },
    { "id": "llm",           "label": "LLM",                      "aliases": ["large language model", "language model", "GPT", "instruction tuning"] },
    { "id": "multimodal",    "label": "Multimodal",               "aliases": ["vision-language", "multi-modal", "VLM", "image-text"] },
    { "id": "rl",            "label": "Reinforcement Learning",   "aliases": ["RLHF", "reward model", "PPO", "DPO", "policy gradient"] },
    { "id": "cv",            "label": "Computer Vision",          "aliases": ["image classification", "object detection", "segmentation", "CLIP"] },
    { "id": "nlp",           "label": "NLP",                      "aliases": ["text classification", "named entity", "sentiment", "summarization"] },
    { "id": "efficient",     "label": "Efficient AI",             "aliases": ["pruning", "distillation", "sparsity", "hardware efficient", "inference optimization"] },
    { "id": "agent",         "label": "AI Agent",                 "aliases": ["tool use", "autonomous agent", "agentic", "planning"] },
    { "id": "rag",           "label": "RAG / Retrieval",          "aliases": ["retrieval augmented", "vector search", "dense retrieval"] },
    { "id": "safety",        "label": "AI Safety",                "aliases": ["alignment", "red teaming", "jailbreak", "hallucination"] },
    { "id": "video",         "label": "Video Generation",         "aliases": ["video synthesis", "video diffusion", "text-to-video"] },
    { "id": "3d",            "label": "3D / NeRF",                "aliases": ["neural radiance", "3D reconstruction", "gaussian splatting"] },
    { "id": "speech",        "label": "Speech / Audio",           "aliases": ["TTS", "ASR", "speech synthesis", "audio generation"] },
    { "id": "code",          "label": "Code Generation",          "aliases": ["code completion", "program synthesis", "coding LLM"] },
    { "id": "robotics",      "label": "Robotics",                 "aliases": ["embodied AI", "manipulation", "robot learning"] },
    { "id": "other",         "label": "Other",                    "aliases": [] }
  ]
}
```

权重字段 `scoring` 由 `server.ts` 在**每次** `/api/papers` 请求时从文件读取（不在进程启动时缓存），从而支持运行时调优无需重启服务。`categories` 字段同理（每次 `/api/categories` 请求时重新读取文件）。

### 1.2 `types.ts` 扩展

`PaperAnalysis` 新增两个字段，`server/analyzeService.ts` 中的重复定义删除，改为 `import { PaperAnalysis } from '../types'`：

```typescript
export interface PaperAnalysis {
  paperId: string;
  geminiSummary: string;
  keyInnovation: string;
  potentialImpact: string;
  relevanceScore: number;                  // 已有：1-10，针对普通 AI 研究者
  categories: string[];                    // 新增：如 ["attention", "llm"]
  categoryScores: Record<string, number>;  // 新增：如 {"attention": 9, "llm": 6}
}
```

**旧缓存兼容**：读取 `analyze_papers_result.json` 时，`categories` 缺失 → 视为 `[]`，`categoryScores` 缺失 → 视为 `{}`。前端将这类论文归入 "All"，不归入任何具体类别标签。

---

## 第二节：后端改动

### 2.1 AI 分析扩展（`analyzeService.ts`）

1. 去掉 `slice(0, BATCH_SIZE)` 对分析数量的截断，改为分析全量今日 HF 论文
2. `max_tokens` 从 4096 提升到 8192
3. Prompt 末尾追加分类指令（类别 ID 列表从 `categories.json` 动态注入）：

```
5. 从以下预定义类别中，选出该论文最相关的 1-3 个类别，并给出每个类别的相关度评分（1-10）。
   可选类别 ID：[attention, moe, quantization, diffusion, llm, multimodal, rl, cv, nlp,
                  efficient, agent, rag, safety, video, 3d, speech, code, robotics, other]
   在每个论文 JSON 中返回：
   - categories: string[]（选中的类别 ID 列表）
   - categoryScores: object（key 为类别 ID，value 为 1-10 评分）
   不相关的类别不需要出现在 categoryScores 中。
```

   **OpenAI response_format 处理**：当前 `analyzeService.ts` 使用 `response_format: { type: 'json_object' }`，模型返回顶层对象，再通过 `Object.values(parsed).find(Array.isArray)` 提取数组。新增字段后，解析逻辑不变，但需确认 prompt 的示例输出也同步包含 `categories` 和 `categoryScores` 字段，让模型正确理解输出格式：

```json
[
  {
    "paperId": "...",
    "geminiSummary": "...",
    "keyInnovation": "...",
    "potentialImpact": "...",
    "relevanceScore": 8,
    "categories": ["attention", "llm"],
    "categoryScores": { "attention": 9, "llm": 6 }
  }
]
```

4. **已分析论文跳过逻辑**：避免 AI 分类结果在刷新时漂移。伪代码：

```
fetchAndAnalyzePapers():
  todayPapers = fetchFromHuggingFace()          // 获取今日全量论文
  cached = readAnalyzedPapersCache()            // 读取 analyze_papers_result.json
  alreadyAnalyzed = Set(cached.map(p => p.id)) // 已分析的论文 ID 集合

  toAnalyze = todayPapers.filter(p => !alreadyAnalyzed.has(p.id))
  // 仍然更新 upvotes：用今日最新 upvotes 覆盖缓存中同 ID 论文的 upvotes 字段
  // 但 categories / categoryScores / geminiSummary 等 AI 分析字段不重新生成

  if toAnalyze.length > 0:
    newAnalyses = analyzeWithOpenAI(toAnalyze)
    merged = merge(cached, newAnalyses)         // 以 paperId 为 key 合并
    writeAnalyzedPapersCache(merged)

  return readAnalyzedPapersCache()
```

> **注意**：仅今日日期的缓存被视为有效。若缓存日期不是今天（服务跨日重启场景），则全量重新分析。

### 2.2 排序函数（`server.ts` 新增）

```typescript
function computeFinalScore(
  paper: AnalyzedPaper,
  category: string | undefined,
  allPapers: AnalyzedPaper[],
  weights: { w_upvotes: number; w_relevance: number; w_category: number }
): number {
  const maxUpvotes = Math.max(...allPapers.map(p => p.upvotes ?? 0), 1);
  // clamp 到 maxUpvotes，防止极值将其他论文压缩到 0 附近
  const u = Math.min(paper.upvotes ?? 0, maxUpvotes) / maxUpvotes;
  const r = (paper.analysis?.relevanceScore ?? 0) / 10;
  const c = category
    ? (paper.analysis?.categoryScores?.[category] ?? 0) / 10
    : 0.5;  // All 视图下类别维度取中间值
  return weights.w_upvotes * u + weights.w_relevance * r + weights.w_category * c;
}
```

权重从 `categories.json` 的 `scoring` 字段读取。

**Hidden Gem 标记**：`categoryScores` 中最高分类别评分 >= 9 且 `upvotes < 20`，标记为 Hidden Gem。

### 2.3 API 变更

#### 修改 `GET /api/papers`（breaking change，前端同步适配）

响应格式从数组改为对象：

```json
{
  "papers": [
    {
      "id": "...",
      "title": "...",
      "upvotes": 42,
      "analysis": {
        "paperId": "...",
        "geminiSummary": "...",
        "keyInnovation": "...",
        "potentialImpact": "...",
        "relevanceScore": 8,
        "categories": ["attention", "llm"],
        "categoryScores": { "attention": 9, "llm": 6 }
      }
    }
  ],
  "totalCount": 38
}
```

> `categories` 和 `filteredCount` 字段移至前端计算，后端无需关心筛选状态。

#### 新增 `GET /api/categories`

返回 `categories.json` 中的类别列表及排序权重（前端 `computeFinalScore` 需要权重）：

```json
{
  "scoring": {
    "w_upvotes": 0.3,
    "w_relevance": 0.3,
    "w_category": 0.4
  },
  "categories": [
    { "id": "attention", "label": "Attention / Transformer" },
    { "id": "moe",       "label": "MoE (Mixture of Experts)" },
    ...
  ]
}
```

---

## 第三节：前端改动

### 3.1 数据获取层

- `huggingFaceService.ts`：`fetchLatestAIPapers` 适配新响应结构，返回 `{ papers, totalCount }`
- `App.tsx`：
  - 一次性调用 `GET /api/papers`，响应中每篇论文对象自带 `analysis` 字段，无需分离提取
  - 同时调用 `GET /api/categories` 获取类别列表和权重（`scoring`）
  - **`analysis` 字段处理**：当前 `App.tsx` 会将 `analysis` 从 paper 对象中剥离并单独缓存。新方案中 `analysis` 作为 paper 对象的内嵌字段保留，统一存入同一缓存键，不再分离。`services/papersCache.ts` 和 `services/analysisCache.ts` 相应简化（papersCache 存完整带 analysis 的 paper 对象；analysisCache 可废弃或保留用于 localStorage 结构版本升级）
- 类别切换不发请求，纯前端过滤 + 排序

### 3.2 新增 `CategoryFilter.tsx`

水平滚动标签栏：

```
[All] [Attention] [MoE] [量化] [LLM] [Diffusion] [Multimodal] ...
      ← 可水平滚动 →
```

- 标签列表 = `["All", ...categories.json 所有类别]`（固定顺序，全部显示，含今日无论文的类别）
- 默认选中 "All"
- 选中标签高亮
- URL 同步：`?category=attention`，使用 `window.history.pushState` + `window.location.search`（原生 URLSearchParams），不引入 react-router-dom

### 3.3 前端筛选与排序逻辑（`App.tsx`）

```
选中类别
  → 过滤：paper.analysis.categories.includes(selectedCategory)
  → 按 finalScore 降序（finalScore 在前端用相同公式计算，权重从 /api/categories 附带返回）
  → 取 Top 5 展示
  → 若选中类别今日无论文 → 展示空状态
```

**空状态文案**：
> "今日暂无「{类别名}」的论文，试试其他类别？"

**All 视图**：展示全部论文，按 `finalScore`（category 维度取 0.5）降序，不截断。

### 3.4 `PaperCard.tsx` 扩展

- 多类别标签（如 `[Attention] [LLM]`），灰色小 badge
- Top 3 排名角标（`#1` `#2` `#3`），左上角
- Hidden Gem 标记（🔮 + tooltip "AI 评分极高但热度较低的隐藏好论文"）
- 选中类别时，结果区域顶部展示计数：`"Top 5 / 共 12 篇 · Attention"`

### 3.5 缓存兼容

`localStorage` 缓存增加版本号 `CACHE_VERSION = "v2"`，读取时版本不匹配则丢弃重新拉取。

---

## 改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/categories.json` | 新增 | 类别配置 + 排序权重 |
| `types.ts` | 修改 | PaperAnalysis 新增 categories、categoryScores |
| `server/analyzeService.ts` | 修改 | 删除重复类型定义；扩展 prompt（含示例输出）；提升 max_tokens；去掉数量截断；新增跳过已分析论文逻辑 |
| `server/analyzedPapersCacheFile.ts` | 修改 | import PaperAnalysis 从 `../types` 而非 `./analyzeService` |
| `server/server.ts` | 修改 | 新增 /api/categories；修改 /api/papers 响应格式；新增 computeFinalScore；每次请求重新读取 categories.json |
| `services/huggingFaceService.ts` | 修改 | 适配新响应结构 |
| `services/papersCache.ts` | 修改 | 存储带 analysis 的完整 paper 对象；新增 CACHE_VERSION v2 校验 |
| `services/analysisCache.ts` | 修改 | 废弃或简化（analysis 已内嵌在 paper 对象中） |
| `App.tsx` | 修改 | 加载类别列表+权重；集成 CategoryFilter；前端过滤排序逻辑；不再分离 analysis 字段 |
| `components/CategoryFilter.tsx` | 新增 | 水平标签栏组件 |
| `components/PaperCard.tsx` | 修改 | 多类别标签；排名角标；Hidden Gem 标记 |

---

## 不在本 Phase 范围内

- 回溯窗口（查看历史日期论文）
- 邮件按类别分组
- 按类别订阅
- arXiv 补充信息源
- `App.tsx` usePapers hook 重构
