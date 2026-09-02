import tarfile
from pathlib import Path

from mini_pipeline.core.config import ExecutionConfig, StorageConfig
from mini_pipeline.database.models import PluginVersion, TaskRun
from mini_pipeline.executor.task_executor import TaskExecutor
from mini_pipeline.runtime.registry import RuntimeRegistry
from mini_pipeline.runtime.shell import ShellRuntime


def test_local_package_tool_single_mode(tmp_path: Path):
    storage = StorageConfig(
        root=tmp_path,
        workspaces=tmp_path / "workspaces",
        logs=tmp_path / "logs",
        plugins=tmp_path / "plugins",
        artifacts=tmp_path / "artifacts",
        temp=tmp_path / "temp",
    )
    execution = ExecutionConfig()
    runtimes = RuntimeRegistry()
    runtimes.register(ShellRuntime())

    executor = TaskExecutor(
        storage=storage,
        execution=execution,
        runtimes=runtimes,
    )

    plugin_src = Path("examples/plugins/local-package-tool").resolve()
    plugin = PluginVersion(
        id="pv-1",
        plugin_id="p-1",
        name="local-package-tool",
        version="1.0.0",
        source_type="local",
        install_path=str(plugin_src),
        runtime_type="shell",
        entry="run.sh",
    )

    mock_input_dir = tmp_path / "mock_inputs"
    mock_input_dir.mkdir(parents=True)

    # 创建 mock IM tar.gz
    im_dir = mock_input_dir / "im_build"
    (im_dir / "app" / "im").mkdir(parents=True)
    (im_dir / "app" / "im" / ".version").write_text("IM_TEST_V1.0", encoding="utf-8")
    (im_dir / "app" / "im" / "modules" / "im_core").mkdir(parents=True)
    bin_file = im_dir / "app" / "im" / "modules" / "im_core" / "core.bin"
    bin_file.write_text("im_bin", encoding="utf-8")
    im_tar = mock_input_dir / "Ldcar_IECU33_IPD_SW073.tar.gz"
    with tarfile.open(im_tar, "w:gz") as tar:
        tar.add(im_dir / "app", arcname="app")

    # 创建 mock M tar.gz
    m_dir = mock_input_dir / "m_build"
    (m_dir / "m").mkdir(parents=True)
    (m_dir / "m" / ".version").write_text("M_TEST_V1.0", encoding="utf-8")
    swcs_dir = m_dir / "m" / "modules" / "mf_graph" / "meta" / "CSUVL3_main" / "swcs"
    swcs_dir.mkdir(parents=True)
    swcs_content = "- name: im_core\n  affinity: 0-3\n  scheduling_priority: 10\n"
    (swcs_dir / "test.yml").write_text(swcs_content, encoding="utf-8")
    m_tar = mock_input_dir / "DJINS-V7.0.5_OrinX.tar.gz"
    with tarfile.open(m_tar, "w:gz") as tar:
        tar.add(m_dir / "m", arcname="m")

    task = TaskRun(id="task-1", run_id="run-1", step_name="package_step")
    result = executor.execute(
        run_id="run-1",
        task=task,
        plugin=plugin,
        params={
            "full_package_name": "Test_IPD_Package_2026",
        },
        dependencies={},
        uploads={
            "im_package": im_tar,
            "m_package": m_tar,
        },
    )

    assert result.success is True, f"Execution failed: {result.message}"
    workspace = storage.workspaces / "run-1" / "task-1"
    output_dir = workspace / "output" / "Test_IPD_Package_2026"
    assert (output_dir / "Test_IPD_Package_2026.tar.gz").exists()
    assert (output_dir / "Test_IPD_Package_2026.checksum.txt").exists()
    assert (output_dir / "Test_IPD_Package_2026.readme.txt").exists()
    assert (output_dir / "module_affinity.json").exists()
    assert (output_dir / "module_affinity.html").exists()

    readme_text = (output_dir / "Test_IPD_Package_2026.readme.txt").read_text(encoding="utf-8")
    assert "IM_TEST_V1.0" in readme_text
    assert "M_TEST_V1.0" in readme_text


def test_local_package_tool_with_modules(tmp_path: Path):
    storage = StorageConfig(
        root=tmp_path,
        workspaces=tmp_path / "workspaces",
        logs=tmp_path / "logs",
        plugins=tmp_path / "plugins",
        artifacts=tmp_path / "artifacts",
        temp=tmp_path / "temp",
    )
    execution = ExecutionConfig()
    runtimes = RuntimeRegistry()
    runtimes.register(ShellRuntime())

    executor = TaskExecutor(
        storage=storage,
        execution=execution,
        runtimes=runtimes,
    )

    plugin_src = Path("examples/plugins/local-package-tool").resolve()
    plugin = PluginVersion(
        id="pv-1",
        plugin_id="p-1",
        name="local-package-tool",
        version="1.0.0",
        source_type="local",
        install_path=str(plugin_src),
        runtime_type="shell",
        entry="run.sh",
    )

    mock_input_dir = tmp_path / "mock_inputs"
    mock_input_dir.mkdir(parents=True)

    # 1. IM
    im_dir = mock_input_dir / "im_build"
    (im_dir / "app" / "im").mkdir(parents=True)
    (im_dir / "app" / "im" / ".version").write_text("IM_TEST_V2.0", encoding="utf-8")
    (im_dir / "app" / "im" / "modules" / "im_core").mkdir(parents=True)
    bin_file = im_dir / "app" / "im" / "modules" / "im_core" / "core.bin"
    bin_file.write_text("im_bin", encoding="utf-8")
    im_tar = mock_input_dir / "Ldcar_IECU33_IPD_SW073.tar.gz"
    with tarfile.open(im_tar, "w:gz") as tar:
        tar.add(im_dir / "app", arcname="app")

    # 2. M
    m_dir = mock_input_dir / "m_build"
    (m_dir / "m").mkdir(parents=True)
    (m_dir / "m" / ".version").write_text("M_TEST_V2.0", encoding="utf-8")
    swcs_dir = m_dir / "m" / "modules" / "mf_graph" / "meta" / "CSUVL3_main" / "swcs"
    swcs_dir.mkdir(parents=True)
    (swcs_dir / "test.yml").write_text("- name: im_core\n  affinity: 0-3\n", encoding="utf-8")
    m_tar = mock_input_dir / "DJINS-V7.0.5_OrinX.tar.gz"
    with tarfile.open(m_tar, "w:gz") as tar:
        tar.add(m_dir / "m", arcname="m")

    # 3. Thirdparty module
    mod_dir = mock_input_dir / "mod_build" / "extra_module"
    mod_dir.mkdir(parents=True)
    (mod_dir / "extra.so").write_text("binary", encoding="utf-8")
    mod_tar = mock_input_dir / "extra_mod_IPD.tar.gz"
    with tarfile.open(mod_tar, "w:gz") as tar:
        tar.add(mod_dir, arcname="extra_module")

    task = TaskRun(id="task-2", run_id="run-2", step_name="package_step")
    result = executor.execute(
        run_id="run-2",
        task=task,
        plugin=plugin,
        params={
            "full_package_name": "Test_With_Modules_Package",
        },
        dependencies={},
        uploads={
            "im_package": im_tar,
            "m_package": m_tar,
            "modules_package": mod_tar,
        },
    )

    assert result.success is True, f"Execution failed: {result.message}"
    workspace = storage.workspaces / "run-2" / "task-2"
    output_dir = workspace / "output" / "Test_With_Modules_Package"
    assert (output_dir / "Test_With_Modules_Package.tar.gz").exists()
    assert (output_dir / "Test_With_Modules_Package.checksum.txt").exists()
    assert (output_dir / "Test_With_Modules_Package.readme.txt").exists()
    # 额外生成的 im+modules 汇总包
    assert (output_dir / "im_package.tar.gz").exists()
    assert (output_dir / "im_package.checksum.txt").exists()
    assert (output_dir / "im_package.readme.txt").exists()
