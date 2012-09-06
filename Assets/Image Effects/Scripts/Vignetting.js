#pragma strict

@script ExecuteInEditMode
@script RequireComponent(Camera)
@script AddComponentMenu("Image Effects/Vignetting")

class Vignetting extends PostEffectsBase {
    @Range(0.0, 6.0) var intensity = 0.375;
    @Range(0.0, 1.5) var blur = 0.1;
    @Range(0.0, 4.0) var blurSpread = 1.5;

    @HideInInspector var vignetteShader : Shader;
    private var vignetteMaterial : Material;

    function CheckResources() {
        vignetteMaterial = CheckShaderAndCreateMaterial(vignetteShader, vignetteMaterial);
        return CheckSupport();
    }

    function OnRenderImage(source : RenderTexture, destination : RenderTexture) {
        if (!CheckResources()) {
            ReportAutoDisable();
            Graphics.Blit(source, destination);
            return;
        }

        var widthOverHeight = (1.0 * source.width) / source.height;
        var oneOverBaseSize = 1.0 / 512;

        var halfRez = RenderTexture.GetTemporary(source.width / 2, source.height / 2, 0);
        var quarterRez = RenderTexture.GetTemporary(source.width / 4, source.height / 4, 0);
        var vignetted = RenderTexture.GetTemporary(source.width / 4, source.height / 4, 0);

        Graphics.Blit(source, halfRez);
        Graphics.Blit(halfRez, quarterRez);

        vignetteMaterial.SetVector("offsets", Vector4(0, blurSpread * oneOverBaseSize, 0, 0));
        Graphics.Blit(quarterRez, vignetted, vignetteMaterial, 1);
        vignetteMaterial.SetVector("offsets", Vector4(blurSpread * oneOverBaseSize / widthOverHeight, 0, 0, 0));
        Graphics.Blit(vignetted, quarterRez, vignetteMaterial, 1);

        vignetteMaterial.SetFloat("intensity", intensity);
        vignetteMaterial.SetFloat("blur", blur);
        vignetteMaterial.SetTexture("vignetteTex", quarterRez);
        Graphics.Blit(source, destination, vignetteMaterial, 0);
        
        RenderTexture.ReleaseTemporary(halfRez);           
        RenderTexture.ReleaseTemporary(quarterRez);    
        RenderTexture.ReleaseTemporary(vignetted);  
    }
}
