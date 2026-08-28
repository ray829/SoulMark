/**
 * 打盹小猫 — 空状态视觉锚点。
 * 由用户提供的 styled-components 版 Loader 改写为纯 CSS 体系:
 * 内联 SVG(猫身 + 尾巴 + ZZZ) + className 接 App.css,颜色用 var(--text) 随主题切换。
 * 动画:尾巴轻摆、ZZZ 闪烁;prefers-reduced-motion 下静止(见 App.css)。
 */
export function SleepingCat() {
  return (
    <div className="sleeping-cat" aria-hidden="true">
      <div className="cat-wrapper">
        <div className="cat-container">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 733 673"
            className="cat-body"
          >
            <path
              fill="currentColor"
              d="M111.002 139.5C270.502 -24.5001 471.503 2.4997 621.002 139.5C770.501 276.5 768.504 627.5 621.002 649.5C473.5 671.5 246 687.5 111.002 649.5C-23.9964 611.5 -48.4982 303.5 111.002 139.5Z"
            />
            <path
              fill="currentColor"
              d="M184 9L270.603 159H97.3975L184 9Z"
            />
            <path
              fill="currentColor"
              d="M541 0L627.603 150H454.397L541 0Z"
            />
          </svg>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 158 564"
            className="cat-tail"
          >
            <path
              fill="currentColor"
              d="M5.97602 76.066C-11.1099 41.6747 12.9018 0 51.3036 0V0C71.5336 0 89.8636 12.2558 97.2565 31.0866C173.697 225.792 180.478 345.852 97.0691 536.666C89.7636 553.378 73.0672 564 54.8273 564V564C16.9427 564 -5.4224 521.149 13.0712 488.085C90.2225 350.15 87.9612 241.089 5.97602 76.066Z"
            />
          </svg>
          <div className="cat-zzz">
            <span className="cat-zzz-big">Z</span>
            <span className="cat-zzz-sm">Z</span>
          </div>
        </div>
        {/* 砖墙:猫靠着的衬景,比猫身更淡,形成层次 */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 500 126"
          className="cat-wall"
        >
          <line x1="50" y1="3" x2="450" y2="3" />
          <line x1="100" y1="85" x2="400" y2="85" />
          <line x1="125" y1="122" x2="375" y2="122" />
          <line x1="0" y1="43" x2="500" y2="43" />
          <line x1="115.5" y1="43.0061" x2="115.5" y2="1.99391" />
          <line x1="189" y1="43.0122" x2="189" y2="2.00002" />
          <line x1="262.5" y1="43.0183" x2="262.5" y2="2.00612" />
          <line x1="336" y1="43.0244" x2="336" y2="2.01222" />
          <line x1="409.5" y1="43.0305" x2="409.5" y2="2.01833" />
          <line x1="153" y1="84.0122" x2="153" y2="43" />
          <line x1="228" y1="84.0122" x2="228" y2="43" />
          <line x1="303" y1="84.0122" x2="303" y2="43" />
          <line x1="378" y1="84.0122" x2="378" y2="43" />
          <line x1="192" y1="125.012" x2="192" y2="84" />
          <line x1="267" y1="125.012" x2="267" y2="84" />
          <line x1="342" y1="125.012" x2="342" y2="84" />
        </svg>
      </div>
    </div>
  );
}

export default SleepingCat;
