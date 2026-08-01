import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

// 不使用 StrictMode:Milkdown 的 useEditor 在 StrictMode 双重挂载下会重复初始化编辑器
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
