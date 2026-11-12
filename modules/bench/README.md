# ui-bench

Benchmarks of the retained tree (`ui-tree`) and the framework (`ui-app`). The scenarios, their
sizes and their names follow the benchmarks of
[FerroUI](https://github.com/wieslawsoltes/FerroUI/tree/main/tests/FerroUI.Benchmarks)
(`category::Class.benchmark[parameters]`), so the two tables can be read side by side. Only the
scenarios and numbers are taken from there; the code is lib-ui's own, in CSS terms: a Border is a
box, a StackPanel a flex box, a WrapPanel a wrapping flex box, a Canvas child an absolutely
positioned box, a Grid or UniformGrid a CSS grid, a TextBlock a text node.

```sh
silk build --release --manifest-path modules/bench/silk.toml
build/llvm/<target>/release/ui-bench                  # every benchmark (a few minutes)
build/llvm/<target>/release/ui-bench Propagation Text # names containing either part
build/llvm/<target>/release/ui-bench --quick          # shorter samples
build/llvm/<target>/release/ui-bench --smoke          # each benchmark once, nothing measured
```

Measure an optimized build on a quiet machine, and compare runs of two builds on the same
machine rather than numbers from different machines. The benchmarks are not part of CI: hosted
runners are too noisy for them, and `--smoke` is enough to show that every scenario still builds
and runs.

## The harness

A benchmark is a value with a `prepare` step, not timed, and a `body`, timed. A pilot run finds
how many operations fill a sample (100 ms, 20 ms with `--quick`; at most four times that in wall
time when the prepare step dominates), then two warm-up samples and nine measured ones (one and
five with `--quick`) follow. The table has the median and the least time of one operation, and
the operations of a sample.

## What an operation includes

Where FerroUI's operation leaves work for the layout pass after it, the operation here includes
that layout, so it measures at least as much work:

| Benchmark | Operation |
| --- | --- |
| `trees::Lifetime.build` | Make a detached wall of 2,000 tiles (12,000 nodes) |
| `trees::Lifetime.attach` | Append the built wall under the root |
| `trees::Lifetime.attach_top_down` | Append each tile to an attached canvas, then its parts under it |
| `trees::Lifetime.lay_out` | Resolve styles and lay out a wall that was attached and never laid out |
| `trees::Lifetime.detach` | Remove a laid-out wall from the root, and lay the root out |
| `trees::Lifetime.clear` | Destroy the tiles of a detached wall |
| `trees::Lifetime.first_frame` | Styles, layout and paint of a newly attached wall (no FerroUI counterpart) |
| `trees::Propagation.*` | Change an inherited property (font family, weight, size, colour, `visibility`, `direction`) on the wall's canvas, and lay out |
| `trees::Text.create_and_measure` | Make 2,000 five-digit labels, lay them out and read their widths |
| `trees::Text.change_and_lay_out` | Change the text of each of 2,000 labels in a column, and lay out |
| `trees::Text.narrow_and_lay_out` | Change the width of a wrapping panel of 500 paragraphs by 20 px, and lay out |
| `layout_subsystem::PanelMeasureArrange.*` | Forget every kept layout result of a panel of 1,000 leaves and lay it out again |
| `layout_subsystem::Invalidation.resize_one_leaf` | Make one of 4,000 leaves 1 px wider or narrower, and lay out |
| `layout_subsystem::Invalidation.measure_every_leaf` | Forget every kept layout result of the 4,000 leaves and lay out |
| `layout_subsystem::NestedDepth.*` | 200 nested boxes: lay out from scratch, or after the innermost one changed width |
| `layout_subsystem::SizeChange.*` | The root goes from 1,280 to 960 px wide or back, over 1,000 leaves, and lay out |
| `declarative::ViewBenchmark.*` | Model change, `view`, diff and the tree applying the mutations, on 1,000 keyed rows or 2,600 cells (`lazy` for memoized) |

FerroUI's DockPanel, the element-level properties of its property system (bindings, styled and
direct properties, resource dictionaries), XAML parsing and its themes have no lib-ui counterpart
and are left out.
