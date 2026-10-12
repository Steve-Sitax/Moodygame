using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
namespace Scheldemist.Net;

internal static class WinJob
{
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private const uint KillOnJobClose = 0x2000;
    private const int ExtendedLimitInformation = 9;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    /// <summary>Put the process in a new kill-on-close job; zero when Windows refuses (the plain stop still works).</summary>
    public static IntPtr KillOnClose(Process p)
    {
        try
        {
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return IntPtr.Zero;
            var info = new ExtendedLimits { Basic = new BasicLimits { LimitFlags = KillOnJobClose } };
            if (!SetInformationJobObject(job, ExtendedLimitInformation, ref info, (uint)Marshal.SizeOf<ExtendedLimits>()) || !AssignProcessToJobObject(job, p.Handle))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
            return job;
        }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException or InvalidOperationException)
        {
            return IntPtr.Zero;
        }
    }

    public static void Close(IntPtr job)
    {
        try
        {
            CloseHandle(job);
        }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException)
        {
            // not Windows after all
        }
    }
}
