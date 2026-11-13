// The benchmark app: a counter button, a controlled text field, and a button that renders
// 1,000 rows. Every target runs this same component. Only `platform` differs: it names the
// host elements (`box` on the tree, `div` in a browser) and reads an input's value.
import { useLayoutEffect, useState } from "react";
import { Box, Input, inputValue, mark } from "platform";

const button = {
  position: "absolute",
  width: 180,
  height: 60,
  fontSize: 20,
  color: "white",
  backgroundColor: "rgb(0, 100, 200)",
  borderRadius: 8,
};

export function Counter() {
  const [clicks, setClicks] = useState(0);
  const [name, setName] = useState("");
  const [rows, setRows] = useState(0);

  // Reports when the frame showing a change is on screen (see `mark` in each platform).
  useLayoutEffect(() => {
    if (clicks > 0) mark("click " + clicks);
  }, [clicks]);
  useLayoutEffect(() => {
    if (rows > 0) mark("rows " + rows);
  }, [rows]);

  const list = [];
  for (let i = 0; i < rows; i++) {
    list.push(
      <Box key={i} style={{ height: 16, fontSize: 12 }}>
        {"Row " + i + " of " + rows}
      </Box>,
    );
  }

  return (
    <Box style={{ position: "relative", width: 400, height: 300, overflow: "hidden" }}>
      <Box style={{ ...button, left: 20, top: 20 }} onClick={() => setClicks(clicks + 1)}>
        {clicks === 0 ? "Click me" : "Clicked " + clicks + " times"}
      </Box>
      <Box style={{ ...button, left: 200, top: 20 }} onClick={() => setRows(rows + 1000)}>
        Add 1000 rows
      </Box>
      <Input
        placeholder="Your name"
        value={name}
        onInput={(event) => setName(inputValue(event).toUpperCase())}
        style={{ position: "absolute", left: 20, top: 100, width: 200, height: 30 }}
      />
      <Box style={{ position: "absolute", left: 20, top: 140, fontSize: 14 }}>
        {name ? "Hello " + name : "Type a name"}
      </Box>
      <Box style={{ position: "absolute", left: 20, top: 170, right: 0, bottom: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {list}
      </Box>
    </Box>
  );
}
