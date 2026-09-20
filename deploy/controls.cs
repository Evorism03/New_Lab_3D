using System;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Собственные элементы окна управления: скруглённые кнопки, карточки, поля, переключатель и индикатор.
// Компилируется один раз и кэшируется (см. app.ps1). Синтаксис - C# 5 (компилятор из Windows).
namespace Lab3D
{
    public static class Native
    {
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] public static extern int SetWindowTheme(IntPtr hwnd, string appName, string idList);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, string lParam);
    }

    public interface IFill { Color FillColor { get; } }

    public static class Gfx
    {
        public static GraphicsPath Round(RectangleF r, float radius)
        {
            float d = Math.Min(radius * 2f, Math.Min(r.Width, r.Height));
            GraphicsPath p = new GraphicsPath();
            if (d <= 0f) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        // Цвет того, что находится за элементом: заливка ближайшей карточки или фон контейнера.
        public static Color Behind(Control c)
        {
            Control p = c.Parent;
            while (p != null)
            {
                IFill f = p as IFill;
                if (f != null) return f.FillColor;
                if (p.BackColor.A != 0 && p.BackColor != Color.Transparent) return p.BackColor;
                p = p.Parent;
            }
            return Color.Black;
        }

        public static void Quality(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        }
    }

    // Кнопка: скруглённая, с наведением/нажатием, значком (Segoe MDL2 Assets) и режимом пункта меню.
    public class RoundButton : Button
    {
        public Color Fill = Color.Gray, HoverFill = Color.Gray, PressFill = Color.Gray, Edge = Color.Empty, Ink = Color.White;
        public Color OffFill = Color.Black, OffInk = Color.DimGray, OffEdge = Color.Empty;
        public Color ActiveFill = Color.Empty, ActiveInk = Color.Empty, ActiveEdge = Color.Empty, Bar = Color.Empty;
        public int Radius = 10;
        public string Glyph = "";
        public bool NavMode;
        public bool Active;
        bool hover, down;

        public RoundButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat;
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { down = true; Invalidate(); } base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }

        public void SetActive(bool value) { Active = value; Invalidate(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Gfx.Quality(g);
            float k = g.DpiX / 96f;
            Color behind = Gfx.Behind(this);
            g.Clear(behind);

            Color fill, ink, edge;
            if (!Enabled) { fill = OffFill; ink = OffInk; edge = OffEdge; }
            else if (Active && ActiveFill != Color.Empty)
            {
                fill = ActiveFill; ink = ActiveInk != Color.Empty ? ActiveInk : Ink; edge = ActiveEdge;
                if (hover && !NavMode) fill = HoverFill;
            }
            else
            {
                fill = down ? PressFill : (hover ? HoverFill : Fill); ink = Ink; edge = Edge;
                if (NavMode && !hover) fill = Color.Empty;
            }

            RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
            float radius = Radius * k;
            using (GraphicsPath path = Gfx.Round(r, radius))
            {
                if (fill != Color.Empty) using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, path);
                if (edge != Color.Empty) using (Pen pen = new Pen(edge, 1f)) g.DrawPath(pen, path);
            }

            if (NavMode && Active && Bar != Color.Empty)
            {
                float bh = Height * 0.5f;
                RectangleF bar = new RectangleF(0f, (Height - bh) / 2f, 3f * k, bh);
                using (GraphicsPath bp = Gfx.Round(bar, 1.5f * k)) using (SolidBrush bb = new SolidBrush(Bar)) g.FillPath(bb, bp);
            }

            TextFormatFlags flags = TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;
            using (Font iconFont = new Font("Segoe MDL2 Assets", 11.5f))
            {
                Size gs = string.IsNullOrEmpty(Glyph) ? Size.Empty : TextRenderer.MeasureText(g, Glyph, iconFont, Size.Empty, flags);
                Size ts = string.IsNullOrEmpty(Text) ? Size.Empty : TextRenderer.MeasureText(g, Text, Font, Size.Empty, flags);
                float gap = (gs.Width > 0 && ts.Width > 0) ? 10f * k : 0f;
                float total = gs.Width + gap + ts.Width;
                float x = NavMode ? 20f * k : (Width - total) / 2f;
                if (gs.Width > 0)
                {
                    TextRenderer.DrawText(g, Glyph, iconFont, new Point((int)x, (int)((Height - gs.Height) / 2f) + 1), ink, flags);
                    x += gs.Width + gap;
                }
                if (ts.Width > 0)
                    TextRenderer.DrawText(g, Text, Font, new Point((int)x, (int)((Height - ts.Height) / 2f)), ink, flags);
            }
        }
    }

    // Карточка со скруглёнными углами.
    public class CardPanel : Panel, IFill
    {
        public Color Fill = Color.Black;
        public Color Edge = Color.Empty;
        public int Radius = 14;
        public Color FillColor { get { return Fill; } }

        public CardPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Gfx.Quality(g);
            g.Clear(Parent != null ? Gfx.Behind(this) : BackColor);
            RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
            using (GraphicsPath path = Gfx.Round(r, Radius * g.DpiX / 96f))
            {
                using (SolidBrush b = new SolidBrush(Fill)) g.FillPath(b, path);
                if (Edge != Color.Empty) using (Pen pen = new Pen(Edge, 1f)) g.DrawPath(pen, path);
            }
        }
    }

    // Поле ввода в скруглённой рамке, при фокусе рамка становится акцентной.
    public class RoundTextBox : Panel, IFill
    {
        public TextBox Inner = new TextBox();
        Color fill = Color.Black;
        public Color Edge = Color.Empty, FocusEdge = Color.Empty;
        public int Radius = 9;
        bool focused;
        string cue = "";

        public Color Fill { get { return fill; } set { fill = value; Inner.BackColor = value; Invalidate(); } }
        public Color FillColor { get { return fill; } }
        public bool Secret { get { return Inner.UseSystemPasswordChar; } set { Inner.UseSystemPasswordChar = value; } }
        public string Cue { get { return cue; } set { cue = value; ApplyCue(); } }
        public override string Text { get { return Inner.Text; } set { Inner.Text = value; } }
        public override Font Font { get { return base.Font; } set { base.Font = value; Inner.Font = value; LayoutInner(); } }

        public RoundTextBox()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Height = 40;
            Inner.BorderStyle = BorderStyle.None;
            Controls.Add(Inner);
            Inner.GotFocus += delegate { focused = true; Invalidate(); };
            Inner.LostFocus += delegate { focused = false; Invalidate(); };
            Inner.HandleCreated += delegate { ApplyCue(); };
            Click += delegate { Inner.Focus(); };
        }

        void ApplyCue()
        {
            if (Inner.IsHandleCreated) Native.SendMessage(Inner.Handle, 0x1501, 1, cue);
        }

        void LayoutInner()
        {
            int pad = (int)(12 * 1f);
            Inner.SetBounds(pad, (Height - Inner.Height) / 2, Math.Max(10, Width - pad * 2), Inner.Height);
        }

        protected override void OnResize(EventArgs e) { base.OnResize(e); LayoutInner(); }
        protected override void OnFontChanged(EventArgs e) { base.OnFontChanged(e); LayoutInner(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Gfx.Quality(g);
            g.Clear(Parent != null ? Gfx.Behind(this) : BackColor);
            RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
            using (GraphicsPath path = Gfx.Round(r, Radius * g.DpiX / 96f))
            {
                using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, path);
                Color edge = (focused && FocusEdge != Color.Empty) ? FocusEdge : Edge;
                if (edge != Color.Empty) using (Pen pen = new Pen(edge, 1f)) g.DrawPath(pen, path);
            }
        }
    }

    // Переключатель вместо флажка.
    public class ToggleSwitch : CheckBox
    {
        public Color OnColor = Color.Green, OffColor = Color.Gray, Knob = Color.White, Ink = Color.White;

        public ToggleSwitch()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
            AutoSize = false;
            Height = 30;
        }

        protected override void OnCheckedChanged(EventArgs e) { Invalidate(); base.OnCheckedChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Gfx.Quality(g);
            float k = g.DpiX / 96f;
            g.Clear(Gfx.Behind(this));
            float tw = 42f * k, th = 22f * k;
            float ty = (Height - th) / 2f;
            RectangleF track = new RectangleF(0.5f, ty, tw, th);
            using (GraphicsPath p = Gfx.Round(track, th / 2f)) using (SolidBrush b = new SolidBrush(Checked ? OnColor : OffColor)) g.FillPath(b, p);
            float kd = th - 6f * k;
            float kx = Checked ? track.Right - kd - 3f * k : track.X + 3f * k;
            using (SolidBrush kb = new SolidBrush(Knob)) g.FillEllipse(kb, kx, ty + 3f * k, kd, kd);
            TextFormatFlags flags = TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;
            Size ts = TextRenderer.MeasureText(g, Text, Font, Size.Empty, flags);
            TextRenderer.DrawText(g, Text, Font, new Point((int)(tw + 12f * k), (int)((Height - ts.Height) / 2f)), Ink, flags);
        }
    }

    // Круглый индикатор состояния с мягким свечением; при Pulse - пульсирует.
    public class StatusDot : Control
    {
        Color dot = Color.Gray;
        bool pulse;
        float phase;
        Timer timer = new Timer();

        public Color DotColor { get { return dot; } set { dot = value; Invalidate(); } }
        public bool Pulse
        {
            get { return pulse; }
            set { pulse = value; timer.Enabled = value; if (!value) { phase = 0f; Invalidate(); } }
        }

        public StatusDot()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            timer.Interval = 60;
            timer.Tick += delegate { phase += 0.22f; Invalidate(); };
        }

        protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Gfx.Quality(g);
            g.Clear(Gfx.Behind(this));
            float cx = Width / 2f, cy = Height / 2f;
            float r = Math.Min(Width, Height) * 0.26f;
            float wave = pulse ? (float)(Math.Sin(phase) * 0.5 + 0.5) : 0.3f;
            float glow = r * (1.55f + wave * 0.75f);
            int alpha = (int)(28 + wave * 46);
            using (SolidBrush gb = new SolidBrush(Color.FromArgb(alpha, dot))) g.FillEllipse(gb, cx - glow, cy - glow, glow * 2f, glow * 2f);
            using (SolidBrush db = new SolidBrush(dot)) g.FillEllipse(db, cx - r, cy - r, r * 2f, r * 2f);
        }
    }
}
