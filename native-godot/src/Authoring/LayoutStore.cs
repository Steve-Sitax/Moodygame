using System;
using System.IO;
using System.Text;

namespace Scheldemist.Native.Authoring;

/// <summary>Atomic writes with a previous-version backup. An unreadable layout cannot be overwritten.</summary>
public sealed class LayoutStore
{
    public string File { get; }
    public bool Writable { get; private set; } = true;
    public LayoutStore(string file) => File = Path.GetFullPath(file);

    public LayoutDocument? Read()
    {
        if (!System.IO.File.Exists(File)) return null;
        try
        {
            if (new FileInfo(File).Length > 4 * 1024 * 1024) throw new InvalidDataException("The layout file is too large.");
            return LayoutDocument.Decode(System.IO.File.ReadAllText(File));
        }
        catch { Writable = false; throw; }
    }

    public void RefuseWrites() => Writable = false;

    public void Save(LayoutDocument document)
    {
        if (!Writable) throw new InvalidOperationException("The saved layout needs repair before it can be replaced. Its backup is kept beside it.");
        Directory.CreateDirectory(Path.GetDirectoryName(File)!);
        string temporary = File + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                byte[] data = Encoding.UTF8.GetBytes(document.Encode());
                stream.Write(data);
                stream.Flush(true);
            }
            if (System.IO.File.Exists(File)) System.IO.File.Replace(temporary, File, File + ".bak");
            else System.IO.File.Move(temporary, File);
        }
        finally { if (System.IO.File.Exists(temporary)) System.IO.File.Delete(temporary); }
    }
}
